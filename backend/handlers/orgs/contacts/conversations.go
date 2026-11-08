package contacts

import (
	"context"
	"errors"
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

func (m outgoing) params(orgDID, hubDID pgtype.UUID) sqlc.AddOrgConversationMessageParams {
	params := sqlc.AddOrgConversationMessageParams{
		OrgDid: orgDID, HubUserDid: hubDID,
		SenderType: string(contacts.MessageSenderTypeAgency),
		Kind:       string(contacts.MessageKindText),
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
				contact, err := q.LockOrgContactByHandle(ctx, sqlc.LockOrgContactByHandleParams{
					OrgDid: identity.OrgDID, Handle: string(request.Handle),
				})
				if isNoRows(err) {
					return fail(orgsproblem.ContactNotFoundError)
				}
				if err != nil {
					return result{}, nil, fmt.Errorf("lock Contact: %w", err)
				}
				pair := sqlc.GetPendingOrgChatRequestParams{
					OrgDid: identity.OrgDID, HubUserDid: contact.HubUserDid,
				}
				// Writing to the person whose request is pending accepts it
				// first (MKT-REQ-005).
				notice := agencycontacts.NoticeMessage
				pending, err := q.GetPendingOrgChatRequest(ctx, pair)
				switch {
				case isNoRows(err):
				case err != nil:
					return result{}, nil, fmt.Errorf("read pending chat request: %w", err)
				case pending.VetchiumOrgChatRequest.Direction == string(contacts.ToAgency):
					_, err := agencycontacts.AnswerRequest(ctx, q, pending.VetchiumOrgChatRequest,
						agencycontacts.Answer{
							Accept: true, HubUserName: contact.DisplayName,
							HubUserHandle: contact.Handle,
						}, orgAnswerer(s, identity, key))
					if errors.Is(err, agencycontacts.ErrConversationReadOnly) {
						return fail(orgsproblem.ConversationPartyDeletedError)
					}
					if err != nil {
						return result{}, nil, err
					}
					notice = agencycontacts.NoticeRequestAccepted
				}
				conversation, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams(pair))
				if isNoRows(err) {
					return fail(orgsproblem.ConversationNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				// Only a deleted party makes a conversation read-only; the
				// requests setting never does (MKT-CNV-006).
				if conversation.ReadOnlyReason.Valid {
					return fail(orgsproblem.ConversationPartyDeletedError)
				}
				if !agencycontacts.Window(conversation.HubActivityAt,
					conversation.AgencyActivityAt, conversation.WindowSeconds).
					AgencyMayWrite(now) {
					return fail(orgsproblem.ConversationClosedError)
				}
				agency, err := q.GetAgencyDetails(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, fmt.Errorf("read agency: %w", err)
				}
				posted, err := addMessage(ctx, q, s, identity, key,
					message.params(identity.OrgDID, contact.HubUserDid), agency, nil, nil)
				if err != nil {
					return result{}, nil, err
				}
				if rows, err := q.SetConversationActivity(ctx, sqlc.SetConversationActivityParams{
					OrgDid: identity.OrgDID, HubUserDid: contact.HubUserDid,
					AgencyActivityAt: dbvalue.Timestamp(posted.SentAt),
				}); err != nil {
					return result{}, nil, fmt.Errorf("record activity: %w", err)
				} else if rows != 1 {
					return result{}, nil, fmt.Errorf("record activity: %d rows", rows)
				}
				if err := agencycontacts.SyncPointer(ctx, q, identity.OrgDID, contact.HubUserDid, notice); err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: posted}, nil, nil
			})
	}
}

// orgAnswerer audits an agency user's answer as theirs.
func orgAnswerer(
	s *orgsruntime.Server, identity middleware.OrgIdentity, key common.IdempotencyKey,
) agencycontacts.Answerer {
	return agencycontacts.Answerer{
		TenantID: s.TenantID, ActorType: "org_user",
		ActorID: dbvalue.FormatUUID(identity.UserID), Source: "orgs-api",
		IdempotencyKey: dbvalue.Text(string(key)), OrgUserID: identity.UserID,
	}
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
	if row.ContactRows != 1 || row.AuditRows != 1 {
		return contacts.ConversationMessage{}, fmt.Errorf("incomplete message")
	}
	return agencycontacts.Message(sqlc.ListOrgConversationMessagesRow{
		MessageNumber: row.MessageNumber, SenderType: row.SenderType,
		SenderDisplayName: row.SenderDisplayName, Kind: row.Kind,
		MessageText: row.MessageText, ConsumerDomain: row.ConsumerDomain,
		OpeningNumber: row.OpeningNumber, SentAt: row.SentAt,
	}, row.SenderDisplayName), nil
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
		org := dbvalue.FormatUUID(identity.OrgDID)
		var before *pageCursor
		if request.PaginationKey != nil {
			cursor, valid := verify(s, messagesPurpose, *request.PaginationKey,
				org, string(request.Handle))
			if !valid {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			before = &cursor
		}
		contact, ok := contactByHandle(s, w, r, identity, request.Handle)
		if !ok {
			return
		}
		detail, err := readConversation(r.Context(), s.Queries, identity.OrgDID,
			contact.HubUserDid, before, request.EffectiveLimit(), s.CurrentTime(),
			func(at time.Time, number int32) (common.PaginationKey, error) {
				return sign(s, messagesPurpose, pageCursor{
					Org: org, Contact: contact.Handle, At: at, Number: number,
				})
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

// DeleteMessage deletes one of the agency's own text messages; any agency
// user may (MKT-CNV-007). Both sides keep a "Message deleted" stub; only the
// agency's audit keeps the text, and the Hub user's tenant learns of the
// deletion without it.
func DeleteMessage(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.DeleteMessageRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[contacts.ConversationMessage]
		handlerauth.RunIdempotent(s, w, r, "orgs:delete-message",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(replayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				fail := handlerauth.Failure[contacts.ConversationMessage]
				contact, err := q.LockOrgContactByHandle(ctx, sqlc.LockOrgContactByHandleParams{
					OrgDid: identity.OrgDID, Handle: string(request.Handle),
				})
				if isNoRows(err) {
					return fail(orgsproblem.ContactNotFoundError)
				}
				if err != nil {
					return result{}, nil, fmt.Errorf("lock Contact: %w", err)
				}
				deleted, err := q.DeleteOrgConversationMessage(ctx, sqlc.DeleteOrgConversationMessageParams{
					OrgDid: identity.OrgDID, HubUserDid: contact.HubUserDid,
					MessageNumber: int32(request.MessageNumber),
					SenderType:    string(contacts.MessageSenderTypeAgency),
					TenantID:      s.TenantID, ActorType: "org_user",
					ActorID: dbvalue.FormatUUID(identity.UserID), Source: "orgs-api",
					IdempotencyKey: dbvalue.Text(string(key)), KeepText: true,
				})
				if isNoRows(err) {
					_, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
						OrgDid: identity.OrgDID, HubUserDid: contact.HubUserDid,
					})
					if isNoRows(err) {
						return fail(orgsproblem.ConversationNotFoundError)
					}
					if err != nil {
						return result{}, nil, fmt.Errorf("read conversation: %w", err)
					}
					return fail(orgsproblem.ConversationMessageNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				if deleted.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete message deletion")
				}
				agency, err := q.GetAgencyDetails(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, fmt.Errorf("read agency: %w", err)
				}
				if err := agencycontacts.EnqueueAgencyMessageDeleted(ctx, q, identity.OrgDID,
					contact.HubUserDid, agency.Domain, deleted.MessageNumber); err != nil {
					return result{}, nil, err
				}
				return result{
					Status: http.StatusOK, Body: agencycontacts.DeletedMessage(deleted),
				}, nil, nil
			})
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
		contact, ok := contactByHandle(s, w, r, identity, request.Handle)
		if !ok {
			return
		}
		if !contact.HasConversation {
			s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
			return
		}
		if _, err := s.Queries.MarkOrgConversationRead(r.Context(), sqlc.MarkOrgConversationReadParams{
			OrgDid: identity.OrgDID, HubUserDid: contact.HubUserDid,
			TenantID: s.TenantID, ActorID: identity.UserID,
		}); err != nil && !isNoRows(err) {
			s.InternalError(r.Context(), w, "mark conversation read", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.Empty(r.Context(), w, http.StatusOK)
	}
}

// readConversation reads the pair's conversation with one page of its
// messages, newest first; pgx.ErrNoRows reports none.
func readConversation(
	ctx context.Context, q sqlc.Querier, orgDID, hubDID pgtype.UUID,
	before *pageCursor, limit int32, now time.Time,
	next func(time.Time, int32) (common.PaginationKey, error),
) (contacts.ConversationDetail, error) {
	conversation, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: orgDID, HubUserDid: hubDID,
	})
	if err != nil {
		return contacts.ConversationDetail{}, err
	}
	params := sqlc.ListOrgConversationMessagesParams{
		OrgDid: orgDID, HubUserDid: hubDID, PageLimit: limit + 1,
	}
	if before != nil {
		params.BeforeSentAt = dbvalue.Timestamp(before.At)
		params.BeforeMessageNumber = pgtype.Int4{Int32: before.Number, Valid: true}
	}
	rows, err := q.ListOrgConversationMessages(ctx, params)
	if err != nil {
		return contacts.ConversationDetail{}, err
	}
	detail := contacts.ConversationDetail{
		Conversation: conversationSummary(conversation, now),
		Messages:     []contacts.ConversationMessage{},
	}
	for index, row := range rows {
		if index == int(limit) {
			last := detail.Messages[index-1]
			key, err := next(last.SentAt, int32(last.MessageNumber))
			if err != nil {
				return contacts.ConversationDetail{}, err
			}
			detail.NextPaginationKey = &key
			break
		}
		detail.Messages = append(detail.Messages,
			agencycontacts.Message(row, row.SenderDisplayName))
	}
	return detail, nil
}

func conversationSummary(
	row sqlc.GetOrgConversationRow, now time.Time,
) contacts.ConversationSummary {
	window := agencycontacts.Window(row.HubActivityAt, row.AgencyActivityAt,
		row.WindowSeconds).Open(now)
	summary := contacts.ConversationSummary{
		RecordedHubUserName:   row.RecordedHubUserName,
		RecordedHubUserHandle: hub.HubHandle(row.RecordedHubUserHandle),
		RecordedAgencyName:    row.RecordedAgencyName,
		RecordedAgencyDomain:  orgs.OrgDomain(row.RecordedAgencyDomain),
		AgencyUnread:          row.AgencyUnreadCount > 0,
		AgencyMayWriteUntil:   window.AgencyUntil,
		HubMayWriteUntil:      window.HubUntil,
		CreatedAt:             row.CreatedAt.Time.UTC(),
		LastActivityAt:        row.LastActivityAt.Time.UTC(),
	}
	if row.ReadOnlyReason.Valid {
		reason := contacts.ConversationReadOnlyReason(row.ReadOnlyReason.String)
		summary.ReadOnlyReason = &reason
	}
	return summary
}

// today is the UTC calendar date of now, which the daily limits count by.
func today(now time.Time) time.Time {
	year, month, day := now.UTC().Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}
