package contacts

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/agencycontacts"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

const messagesPurpose = "orgs-list-conversation-messages-v1"

// outgoing is an agency message as the request names it.
type outgoing struct {
	text       *contacts.MessageText
	suggestion *contacts.OpeningSuggestion
}

func (m outgoing) params(
	messageID, conversationID pgtype.UUID, sender string,
) sqlc.AddOrgConversationMessageParams {
	params := sqlc.AddOrgConversationMessageParams{
		MessageID: messageID, ConversationID: conversationID,
		SenderType: string(contacts.MessageSenderTypeAgency), SenderDisplayName: sender,
		Kind: string(contacts.MessageKindText),
	}
	if m.suggestion != nil {
		params.Kind = string(contacts.MessageKindSuggestion)
		params.ConsumerDomain = dbvalue.Text(string(m.suggestion.ConsumerDomain))
		params.OpeningNumber = pgtype.Int4{
			Int32: int32(m.suggestion.OpeningNumber), Valid: true,
		}
	} else if m.text != nil {
		params.MessageText = dbvalue.Text(string(*m.text))
	}
	return params
}

// StartConversation opens the agency's conversation with the person at an
// address, creating the Contact and the conversation when they do not exist
// yet (MKT-DAT-004), and posts the first message; starting again posts into
// the conversation that exists. The person and a suggested Opening are read
// before the transaction opens: no transaction waits on another tenant.
func StartConversation(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.StartConversationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		read, ok := readProfile(s, w, r, identity, string(request.Address))
		if !ok {
			return
		}
		if !read.AgenciesMayMessage {
			s.Problem(r.Context(), w, orgsproblem.AgencyMessagesOffError)
			return
		}
		hubDID, err := dbvalue.ParseUUID(string(read.HubUserDID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse Hub user DID", err)
			return
		}
		if !confirmSuggestion(s, w, r, identity, request.Suggestion) {
			return
		}
		message := outgoing{text: request.Text, suggestion: request.Suggestion}
		name, handle := string(read.Profile.DisplayName), string(read.Profile.Handle)
		now := s.CurrentTime()
		type result = handlerauth.Result[contacts.ConversationDetail]
		handlerauth.RunIdempotent(s, w, r, "orgs:start-conversation",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(replayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				fail := handlerauth.Failure[contacts.ConversationDetail]
				if _, err := q.LockOrgForContacts(ctx, identity.OrgDID); err != nil {
					return result{}, nil, fmt.Errorf("lock Org: %w", err)
				}
				today := pgtype.Date{Time: today(now), Valid: true}
				listed, err := q.OrgHasListedSourcingListing(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, err
				}
				contact, err := q.GetOrgContactByPerson(ctx, sqlc.GetOrgContactByPersonParams{
					OrgDid: identity.OrgDID, HubUserDid: hubDID,
				})
				contactID := contact.ContactID
				switch {
				case isNoRows(err):
					if !listed {
						return fail(orgsproblem.ListingNotAvailableError)
					}
					created, err := q.CountOrgContactsCreatedOn(ctx, sqlc.CountOrgContactsCreatedOnParams{
						OrgDid: identity.OrgDID, Day: today,
					})
					if err != nil {
						return result{}, nil, err
					}
					if created >= contacts.MaxNewContactsPerDay {
						return fail(orgsproblem.ContactLimitReachedError)
					}
					if contactID, err = dbvalue.NewUUIDv7(now); err != nil {
						return result{}, nil, err
					}
					row, err := q.CreateOrgContact(ctx, sqlc.CreateOrgContactParams{
						ContactID: contactID, OrgDid: identity.OrgDID, HubUserDid: hubDID,
						DisplayName: name, Handle: handle, ActorID: identity.UserID,
						Day: today, TenantID: s.TenantID,
						IdempotencyKey: dbvalue.Text(string(key)),
					})
					if err != nil {
						return result{}, nil, err
					}
					if row.CreatedRows != 1 || row.CountedRows != 1 || row.AuditRows != 1 {
						return result{}, nil, fmt.Errorf("incomplete Contact creation")
					}
				case err != nil:
					return result{}, nil, err
				default:
					if _, err := q.LockOrgContact(ctx, sqlc.LockOrgContactParams{
						OrgDid: identity.OrgDID, ContactID: contactID,
					}); err != nil {
						return result{}, nil, fmt.Errorf("lock Contact: %w", err)
					}
					if _, err := q.RefreshOrgContactNames(ctx, sqlc.RefreshOrgContactNamesParams{
						DisplayName: name, Handle: handle, ContactID: contactID,
						OrgDid: identity.OrgDID, TenantID: s.TenantID,
						ActorID: identity.UserID, IdempotencyKey: dbvalue.Text(string(key)),
					}); err != nil {
						return result{}, nil, err
					}
				}
				agency, err := q.GetAgencyDetails(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, fmt.Errorf("read agency: %w", err)
				}
				conversation, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
					OrgDid: identity.OrgDID, ContactID: contactID,
				})
				switch {
				case isNoRows(err):
					// A new conversation needs a listed sourcing Listing and
					// room in the day's limit (MKT-CNV-003).
					if !listed {
						return fail(orgsproblem.ListingNotAvailableError)
					}
					started, err := q.CountOrgConversationsCreatedOn(ctx, sqlc.CountOrgConversationsCreatedOnParams{
						OrgDid: identity.OrgDID, Day: today,
					})
					if err != nil {
						return result{}, nil, err
					}
					if started >= contacts.MaxNewConversationsPerDay {
						return fail(orgsproblem.ConversationLimitReachedError)
					}
					conversationID, err := dbvalue.NewUUIDv7(now)
					if err != nil {
						return result{}, nil, err
					}
					row, err := q.CreateOrgConversation(ctx, sqlc.CreateOrgConversationParams{
						ConversationID: conversationID, ContactID: contactID,
						OrgDid: identity.OrgDID, HubUserDid: hubDID,
						RecordedHubUserName: name, RecordedHubUserHandle: handle,
						RecordedAgencyName: agency.DisplayName, RecordedAgencyDomain: agency.Domain,
						Day: today, TenantID: s.TenantID, ActorID: identity.UserID,
						IdempotencyKey: dbvalue.Text(string(key)),
					})
					if err != nil {
						return result{}, nil, err
					}
					if row.CreatedRows != 1 || row.CountedRows != 1 || row.AuditRows != 1 {
						return result{}, nil, fmt.Errorf("incomplete conversation creation")
					}
				case err != nil:
					return result{}, nil, err
				default:
					if details := refusal(conversation.ReadOnlyReason, conversation.MessagesOff); details != nil {
						return fail(details)
					}
				}
				if err := post(ctx, q, s, identity, key, contactID, message,
					agency, &name, &handle); err != nil {
					return result{}, nil, err
				}
				detail, err := readConversation(ctx, q, identity.OrgDID, contactID, nil,
					contacts.DefaultPage, func(at time.Time, id string) (common.PaginationKey, error) {
						return signMessages(s, identity.OrgDID, contactID, at, id)
					})
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: detail}, nil, nil
			})
	}
}

// SendMessage posts into a conversation the agency has (MKT-CNV-004).
func SendMessage(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.SendMessageRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		contactID, err := dbvalue.ParseUUID(string(request.ContactID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse Contact id", err)
			return
		}
		if !confirmSuggestion(s, w, r, identity, request.Suggestion) {
			return
		}
		message := outgoing{text: request.Text, suggestion: request.Suggestion}
		now := s.CurrentTime()
		type result = handlerauth.Result[contacts.ConversationMessage]
		handlerauth.RunIdempotent(s, w, r, "orgs:send-message",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(replayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				fail := handlerauth.Failure[contacts.ConversationMessage]
				if _, err := q.LockOrgContact(ctx, sqlc.LockOrgContactParams{
					OrgDid: identity.OrgDID, ContactID: contactID,
				}); isNoRows(err) {
					return fail(orgsproblem.ContactNotFoundError)
				} else if err != nil {
					return result{}, nil, fmt.Errorf("lock Contact: %w", err)
				}
				conversation, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
					OrgDid: identity.OrgDID, ContactID: contactID,
				})
				if isNoRows(err) {
					return fail(orgsproblem.ConversationNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				if details := refusal(conversation.ReadOnlyReason, conversation.MessagesOff); details != nil {
					return fail(details)
				}
				agency, err := q.GetAgencyDetails(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, fmt.Errorf("read agency: %w", err)
				}
				messageID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				posted, err := addMessage(ctx, q, s, identity, key,
					message.params(messageID, conversation.ConversationID, ""), agency, nil, nil)
				if err != nil {
					return result{}, nil, err
				}
				if err := agencycontacts.SyncPointer(ctx, q, identity.OrgDID, contactID, true); err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: posted}, nil, nil
			})
	}
}

// refusal names why the agency cannot write into a conversation: the other
// party is gone (MKT-CNV-011), or the person turned agency messages off
// (MKT-CNV-006).
func refusal(reason pgtype.Text, messagesOff bool) problem.Body {
	switch {
	case reason.Valid:
		return orgsproblem.ConversationPartyDeletedError
	case messagesOff:
		return orgsproblem.AgencyMessagesOffError
	}
	return nil
}

// post appends an agency message to the Contact's conversation and reports
// it to the person's tenant.
func post(
	ctx context.Context, q *sqlc.Queries, s *orgsruntime.Server,
	identity middleware.OrgIdentity, key common.IdempotencyKey,
	contactID pgtype.UUID, message outgoing, agency sqlc.GetAgencyDetailsRow,
	name, handle *string,
) error {
	conversation, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: identity.OrgDID, ContactID: contactID,
	})
	if err != nil {
		return fmt.Errorf("read conversation: %w", err)
	}
	messageID, err := dbvalue.NewUUIDv7(s.CurrentTime())
	if err != nil {
		return err
	}
	if _, err := addMessage(ctx, q, s, identity, key,
		message.params(messageID, conversation.ConversationID, ""), agency,
		name, handle); err != nil {
		return err
	}
	return agencycontacts.SyncPointer(ctx, q, identity.OrgDID, contactID, true)
}

// addMessage stores an agency message under the sending user's email
// address, which stands in for an Org user's name (MKT-GEN-005).
func addMessage(
	ctx context.Context, q *sqlc.Queries, s *orgsruntime.Server,
	identity middleware.OrgIdentity, key common.IdempotencyKey,
	params sqlc.AddOrgConversationMessageParams, agency sqlc.GetAgencyDetailsRow,
	name, handle *string,
) (contacts.ConversationMessage, error) {
	sender, err := q.GetOrgMyInfo(ctx, identity.UserID)
	if err != nil {
		return contacts.ConversationMessage{}, fmt.Errorf("read sender: %w", err)
	}
	params.SenderUserID = identity.UserID
	params.SenderDisplayName = sender.EmailAddress
	params.HubUserName = dbvalue.NullText(name)
	params.HubUserHandle = dbvalue.NullText(handle)
	params.AgencyName = dbvalue.Text(agency.DisplayName)
	params.AgencyDomain = dbvalue.Text(agency.Domain)
	params.TenantID = s.TenantID
	params.ActorType = "org_user"
	params.ActorID = dbvalue.FormatUUID(identity.UserID)
	params.Source = "orgs-api"
	params.IdempotencyKey = dbvalue.Text(string(key))
	row, err := q.AddOrgConversationMessage(ctx, params)
	if err != nil {
		return contacts.ConversationMessage{}, err
	}
	if row.ConversationRows != 1 || row.ContactRows != 1 || row.AuditRows != 1 {
		return contacts.ConversationMessage{}, fmt.Errorf("incomplete message")
	}
	return message(row.MessageID, row.SenderType, row.SenderDisplayName,
		row.Kind, row.MessageText, row.ConsumerDomain, row.OpeningNumber,
		row.SentAt), nil
}

// confirmSuggestion asks the client's tenant whether the agency is assigned
// to the suggested Opening and it is `published` (MKT-DAT-007): the agency's
// tenant knows only its engagement with the client. It writes the problem
// and reports false when the suggestion cannot be posted.
func confirmSuggestion(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
	identity middleware.OrgIdentity, suggestion *contacts.OpeningSuggestion,
) bool {
	if suggestion == nil {
		return true
	}
	invalid := problem.ValidationFailedError
	invalid.Fields = []string{"suggestion"}
	engagement, err := s.Queries.GetActiveSourcingEngagementWithClient(r.Context(),
		sqlc.GetActiveSourcingEngagementWithClientParams{
			ProviderOrgDid: identity.OrgDID,
			ConsumerDomain: string(suggestion.ConsumerDomain),
		})
	if isNoRows(err) {
		s.Problem(r.Context(), w, invalid)
		return false
	}
	if err != nil {
		s.InternalError(r.Context(), w, "find sourcing engagement", err)
		return false
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.ListingDeadline)
	defer cancel()
	tenant, details := s.ListingRead.HomeOf(ctx, engagement.ConsumerOrgDid)
	if details != nil {
		if details.Type == orgsproblem.ListingNotFoundError.Type {
			s.Problem(r.Context(), w, invalid)
			return false
		}
		s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
		return false
	}
	outcome, err := s.WorkRelay.RelayGetJob(ctx, work.RelayGetJobRequest{
		Tenant: tenant,
		Request: work.PeerGetJobRequest{
			ProviderOrgDID: orgs.OrgDID(dbvalue.FormatUUID(identity.OrgDID)),
			EngagementID:   marketplace.EngagementID(dbvalue.FormatUUID(engagement.EngagementID)),
			OpeningNumber:  suggestion.OpeningNumber,
		},
	})
	switch {
	case err == nil && outcome.Problem != nil &&
		outcome.Problem.Type == orgsproblem.EngagementWorkNotFoundError.Type:
		s.Problem(r.Context(), w, invalid)
		return false
	case err != nil || outcome.Problem != nil || outcome.Result == nil:
		s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
		return false
	case outcome.Result.Job.State != openings.Published:
		s.Problem(r.Context(), w, invalid)
		return false
	}
	return true
}

func GetConversation(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.GetConversationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		contactID, err := dbvalue.ParseUUID(string(request.ContactID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse Contact id", err)
			return
		}
		var before *messageCursor
		if request.PaginationKey != nil {
			cursor, valid := verify(s, messagesPurpose, *request.PaginationKey,
				dbvalue.FormatUUID(identity.OrgDID), string(request.ContactID))
			if !valid {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			before = &messageCursor{at: cursor.At, id: cursor.ID}
		}
		if _, err := s.Queries.GetOrgContact(r.Context(), sqlc.GetOrgContactParams{
			OrgDid: identity.OrgDID, ContactID: contactID,
		}); isNoRows(err) {
			s.Problem(r.Context(), w, orgsproblem.ContactNotFoundError)
			return
		} else if err != nil {
			s.InternalError(r.Context(), w, "read Contact", err)
			return
		}
		detail, err := readConversation(r.Context(), s.Queries, identity.OrgDID,
			contactID, before, request.EffectiveLimit(),
			func(at time.Time, id string) (common.PaginationKey, error) {
				return signMessages(s, identity.OrgDID, contactID, at, id)
			})
		if isNoRows(err) {
			s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read conversation", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, detail)
	}
}

// MarkConversationRead clears the agency's unread count for every agency user
// (MKT-DAT-010).
func MarkConversationRead(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.MarkConversationReadRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		contactID, err := dbvalue.ParseUUID(string(request.ContactID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse Contact id", err)
			return
		}
		if _, err := s.Queries.GetOrgContact(r.Context(), sqlc.GetOrgContactParams{
			OrgDid: identity.OrgDID, ContactID: contactID,
		}); isNoRows(err) {
			s.Problem(r.Context(), w, orgsproblem.ContactNotFoundError)
			return
		} else if err != nil {
			s.InternalError(r.Context(), w, "read Contact", err)
			return
		}
		if _, err := s.Queries.GetOrgConversation(r.Context(), sqlc.GetOrgConversationParams{
			OrgDid: identity.OrgDID, ContactID: contactID,
		}); isNoRows(err) {
			s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
			return
		} else if err != nil {
			s.InternalError(r.Context(), w, "read conversation", err)
			return
		}
		if _, err := s.Queries.MarkOrgConversationRead(r.Context(), sqlc.MarkOrgConversationReadParams{
			OrgDid: identity.OrgDID, ContactID: contactID,
			TenantID: s.TenantID, ActorID: identity.UserID,
		}); err != nil {
			s.InternalError(r.Context(), w, "mark conversation read", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.Empty(r.Context(), w, http.StatusOK)
	}
}

type messageCursor struct {
	at time.Time
	id string
}

func signMessages(
	s *orgsruntime.Server, orgDID, contactID pgtype.UUID, at time.Time, id string,
) (common.PaginationKey, error) {
	return sign(s, messagesPurpose, pageCursor{
		Org: dbvalue.FormatUUID(orgDID), Contact: dbvalue.FormatUUID(contactID),
		At: at, ID: id,
	})
}

// readConversation reads the Contact's conversation with one page of its
// messages, newest first; pgx.ErrNoRows reports none.
func readConversation(
	ctx context.Context, q sqlc.Querier, orgDID, contactID pgtype.UUID,
	before *messageCursor, limit int32,
	next func(time.Time, string) (common.PaginationKey, error),
) (contacts.ConversationDetail, error) {
	conversation, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: orgDID, ContactID: contactID,
	})
	if err != nil {
		return contacts.ConversationDetail{}, err
	}
	params := sqlc.ListOrgConversationMessagesParams{
		ConversationID: conversation.ConversationID, PageLimit: limit + 1,
	}
	if before != nil {
		params.BeforeSentAt = dbvalue.Timestamp(before.at)
		if params.BeforeMessageID, err = dbvalue.ParseUUID(before.id); err != nil {
			return contacts.ConversationDetail{}, err
		}
	}
	rows, err := q.ListOrgConversationMessages(ctx, params)
	if err != nil {
		return contacts.ConversationDetail{}, err
	}
	detail := contacts.ConversationDetail{
		Conversation: conversationSummary(conversation),
		Messages:     []contacts.ConversationMessage{},
	}
	for index, row := range rows {
		if index == int(limit) {
			last := detail.Messages[index-1]
			key, err := next(last.SentAt, string(last.MessageID))
			if err != nil {
				return contacts.ConversationDetail{}, err
			}
			detail.NextPaginationKey = &key
			break
		}
		detail.Messages = append(detail.Messages, message(row.MessageID,
			row.SenderType, row.SenderDisplayName, row.Kind, row.MessageText,
			row.ConsumerDomain, row.OpeningNumber, row.SentAt))
	}
	return detail, nil
}

func conversationSummary(row sqlc.GetOrgConversationRow) contacts.ConversationSummary {
	summary := contacts.ConversationSummary{
		ConversationID:        contacts.ConversationID(dbvalue.FormatUUID(row.ConversationID)),
		ContactID:             contacts.ContactID(dbvalue.FormatUUID(row.ContactID)),
		RecordedHubUserName:   row.RecordedHubUserName,
		RecordedHubUserHandle: hub.HubHandle(row.RecordedHubUserHandle),
		RecordedAgencyName:    row.RecordedAgencyName,
		RecordedAgencyDomain:  orgs.OrgDomain(row.RecordedAgencyDomain),
		AgencyUnread:          row.AgencyUnreadCount > 0,
		CreatedAt:             row.CreatedAt.Time.UTC(),
		LastActivityAt:        row.LastActivityAt.Time.UTC(),
	}
	switch {
	case row.ReadOnlyReason.Valid:
		reason := contacts.ConversationReadOnlyReason(row.ReadOnlyReason.String)
		summary.ReadOnlyReason = &reason
	case row.MessagesOff:
		reason := contacts.ConversationReadOnlyMessagesOff
		summary.ReadOnlyReason = &reason
	}
	return summary
}

func message(
	id pgtype.UUID, sender, name, kind string, text, consumerDomain pgtype.Text,
	openingNumber pgtype.Int4, sentAt pgtype.Timestamptz,
) contacts.ConversationMessage {
	result := contacts.ConversationMessage{
		MessageID:         contacts.MessageID(dbvalue.FormatUUID(id)),
		SenderType:        contacts.MessageSenderType(sender),
		SenderDisplayName: name,
		Kind:              contacts.MessageKind(kind),
		SentAt:            sentAt.Time.UTC(),
	}
	if text.Valid {
		value := contacts.MessageText(text.String)
		result.Text = &value
	}
	if consumerDomain.Valid && openingNumber.Valid {
		result.Suggestion = &contacts.OpeningSuggestion{
			ConsumerDomain: orgs.OrgDomain(consumerDomain.String),
			OpeningNumber:  openings.OpeningNumber(openingNumber.Int32),
		}
	}
	return result
}

// today is the UTC calendar date of now, which the daily limits count by.
func today(now time.Time) time.Time {
	year, month, day := now.UTC().Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}
