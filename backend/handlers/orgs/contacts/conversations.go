package contacts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	orgopenings "github.com/vetchium/src/typespec/orgs/openings"
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

		if request.Suggestion != nil {
			if !validateSuggestion(r.Context(), s, identity.OrgDID, *request.Suggestion, w) {
				return
			}
		}

		now := s.CurrentTime()
		type result = handlerauth.Result[contacts.ConversationDetail]
		handlerauth.RunIdempotent(s, w, r, "orgs:start-conversation",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(replayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				fail := func(details problem.Body) (result, *handlerauth.Problem, error) {
					return handlerauth.Failure[contacts.ConversationDetail](details)
				}

				if _, err := q.LockOrgForContacts(ctx, identity.OrgDID); err != nil {
					return result{}, nil, fmt.Errorf("lock Org: %w", err)
				}

				userInfo, err := q.GetOrgMyInfo(ctx, identity.UserID)
				if err != nil {
					return result{}, nil, fmt.Errorf("get user info: %w", err)
				}
				userDisplayName := userInfo.DisplayName
				if userDisplayName == "" {
					userDisplayName = userInfo.EmailAddress
				}
				agency, err := q.GetAgencyDetails(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, fmt.Errorf("get agency details: %w", err)
				}
				var agencyLogo *string
				if agency.LogoMediaID.Valid {
					str := dbvalue.FormatUUID(agency.LogoMediaID)
					agencyLogo = &str
				}

				name, handle := string(read.Profile.DisplayName), string(read.Profile.Handle)
				today := pgtype.Date{Time: now.UTC().Truncate(24 * time.Hour), Valid: true}

				contact, err := q.GetOrgContactByPerson(ctx, sqlc.GetOrgContactByPersonParams{
					OrgDid: identity.OrgDID, HubUserDid: hubDID,
				})

				var contactID pgtype.UUID
				var conversationID pgtype.UUID
				var pointerVersion int32 = 1

				switch {
				case isNoRows(err):
					// Contact does not exist
					listed, err := q.OrgHasListedSourcingListing(ctx, identity.OrgDID)
					if err != nil {
						return result{}, nil, err
					}
					if !listed {
						return fail(orgsproblem.ListingNotAvailableError)
					}

					contactCount, err := q.CountOrgContactsCreatedOn(ctx, sqlc.CountOrgContactsCreatedOnParams{
						OrgDid: identity.OrgDID, Day: today,
					})
					if err != nil {
						return result{}, nil, err
					}
					if contactCount >= contacts.MaxNewContactsPerDay {
						return fail(orgsproblem.ContactLimitReachedError)
					}

					convCount, err := q.CountOrgConversationsCreatedOn(ctx, sqlc.CountOrgConversationsCreatedOnParams{
						OrgDid: identity.OrgDID, Day: today,
					})
					if err != nil {
						return result{}, nil, err
					}
					if convCount >= contacts.MaxNewConversationsPerDay {
						return fail(orgsproblem.ConversationLimitReachedError)
					}

					contactID, err = dbvalue.NewUUIDv7(now)
					if err != nil {
						return result{}, nil, err
					}
					cRow, err := q.CreateOrgContact(ctx, sqlc.CreateOrgContactParams{
						ContactID: contactID, OrgDid: identity.OrgDID, HubUserDid: hubDID,
						DisplayName: name, Handle: handle, ActorID: identity.UserID,
						Day: today, TenantID: s.TenantID,
						IdempotencyKey: dbvalue.Text(string(key)),
					})
					if err != nil {
						return result{}, nil, err
					}
					if cRow.CreatedRows != 1 || cRow.CountedRows != 1 || cRow.AuditRows != 1 {
						return result{}, nil, fmt.Errorf("incomplete Contact creation")
					}

					if _, err := q.RecordOrgConversationCreation(ctx, sqlc.RecordOrgConversationCreationParams{
						OrgDid: identity.OrgDID, Day: today,
					}); err != nil {
						return result{}, nil, fmt.Errorf("record conversation creation: %w", err)
					}

				case err != nil:
					return result{}, nil, err

				default:
					locked, err := q.LockOrgContact(ctx, sqlc.LockOrgContactParams{
						OrgDid: identity.OrgDID, ContactID: contact.ContactID,
					})
					if err != nil {
						return result{}, nil, fmt.Errorf("lock contact: %w", err)
					}
					contactID = contact.ContactID
					pointerVersion = locked.PointerVersion
					if contact.DisplayName != name || contact.Handle != handle {
						if _, err := q.RefreshOrgContactNames(ctx, sqlc.RefreshOrgContactNamesParams{
							DisplayName: name, Handle: handle, ContactID: contact.ContactID,
							OrgDid: identity.OrgDID, TenantID: s.TenantID,
							ActorID: identity.UserID, IdempotencyKey: dbvalue.Text(string(key)),
						}); err != nil {
							return result{}, nil, err
						}
					}

					conv, err := q.GetOrgConversationByContact(ctx, contactID)
					if err == nil {
						// Conversation already exists -> open it
						if conv.PartyDeletedAt.Valid ||
							(conv.ReadOnlyReason.Valid && (conv.ReadOnlyReason.String == "agency_deleted" || conv.ReadOnlyReason.String == "hub_user_deleted")) {
							return fail(orgsproblem.ConversationPartyDeletedError)
						}
						if contact.MessagesOff || (conv.ReadOnlyReason.Valid && conv.ReadOnlyReason.String == "messages_off") {
							return fail(orgsproblem.AgencyMessagesOffError)
						}

						// Post message in existing conversation
						detail, prob, err := postMessage(ctx, s, q, identity, key, conv.ConversationID, contactID, hubDID,
							agency.DisplayName, agency.Domain, agencyLogo, name, handle, userDisplayName, request.Text, request.Suggestion, now)
						if err != nil || prob != nil {
							return result{}, prob, err
						}
						return result{Status: http.StatusOK, Body: detail}, nil, nil
					} else if !errors.Is(err, pgx.ErrNoRows) {
						return result{}, nil, err
					}

					// Contact exists, conversation does not exist
					listed, err := q.OrgHasListedSourcingListing(ctx, identity.OrgDID)
					if err != nil {
						return result{}, nil, err
					}
					if !listed {
						return fail(orgsproblem.ListingNotAvailableError)
					}

					convCount, err := q.CountOrgConversationsCreatedOn(ctx, sqlc.CountOrgConversationsCreatedOnParams{
						OrgDid: identity.OrgDID, Day: today,
					})
					if err != nil {
						return result{}, nil, err
					}
					if convCount >= contacts.MaxNewConversationsPerDay {
						return fail(orgsproblem.ConversationLimitReachedError)
					}

					if _, err := q.RecordOrgConversationCreation(ctx, sqlc.RecordOrgConversationCreationParams{
						OrgDid: identity.OrgDID, Day: today,
					}); err != nil {
						return result{}, nil, fmt.Errorf("record conversation creation: %w", err)
					}
				}

				// Create new conversation
				conversationID, err = dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}

				convRow, err := q.InsertOrgConversation(ctx, sqlc.InsertOrgConversationParams{
					ConversationID:        conversationID,
					ContactID:             contactID,
					OrgDid:                identity.OrgDID,
					HubUserDid:            hubDID,
					RecordedHubUserName:   name,
					RecordedHubUserHandle: handle,
					RecordedAgencyName:    agency.DisplayName,
					RecordedAgencyDomain:  agency.Domain,
					AgencyUnread:          false,
					CreatedAt:             pgtype.Timestamptz{Time: now, Valid: true},
					LastActivityAt:        pgtype.Timestamptz{Time: now, Valid: true},
				})
				if err != nil {
					return result{}, nil, fmt.Errorf("insert conversation: %w", err)
				}

				// Insert first message
				messageID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}

				msgKind := "text"
				var msgText pgtype.Text
				var consumerDomain pgtype.Text
				var openingNumber pgtype.Int4
				var suggestionList []contacts.OpeningSuggestion

				if request.Suggestion != nil {
					msgKind = "suggestion"
					consumerDomain = dbvalue.Text(string(request.Suggestion.ConsumerDomain))
					openingNumber = pgtype.Int4{Int32: int32(request.Suggestion.OpeningNumber), Valid: true}
					suggestionList = []contacts.OpeningSuggestion{*request.Suggestion}
				} else if request.Text != nil {
					msgText = dbvalue.Text(string(*request.Text))
				}

				msgRow, err := q.InsertOrgConversationMessage(ctx, sqlc.InsertOrgConversationMessageParams{
					MessageID:         messageID,
					ConversationID:    conversationID,
					SenderType:        "agency",
					SenderUserID:      identity.UserID,
					SenderDisplayName: userDisplayName,
					Kind:              msgKind,
					MessageText:       msgText,
					ConsumerDomain:    consumerDomain,
					OpeningNumber:     openingNumber,
					SentAt:            pgtype.Timestamptz{Time: now, Valid: true},
				})
				if err != nil {
					return result{}, nil, fmt.Errorf("insert message: %w", err)
				}

				// Audit events
				auditPayload, _ := json.Marshal(map[string]any{
					"action":          "created",
					"conversation_id": dbvalue.FormatUUID(conversationID),
				})
				if err := q.InsertAuditEvent(ctx, sqlc.InsertAuditEventParams{
					TenantID:          s.TenantID,
					Action:            "org.conversation.created",
					EntityType:        "org_conversation",
					EntityID:          dbvalue.FormatUUID(conversationID),
					ActorType:         "org_user",
					ActorID:           dbvalue.Text(dbvalue.FormatUUID(identity.UserID)),
					SubjectHubUserDid: hubDID,
					SubjectOrgDid:     identity.OrgDID,
					Source:            "orgs-api",
					IdempotencyKey:    dbvalue.Text(string(key)),
					Payload:           auditPayload,
				}); err != nil {
					return result{}, nil, fmt.Errorf("insert audit event: %w", err)
				}

				msgAuditPayload, _ := json.Marshal(map[string]any{
					"action":     "message-sent",
					"message_id": dbvalue.FormatUUID(messageID),
				})
				if err := q.InsertAuditEvent(ctx, sqlc.InsertAuditEventParams{
					TenantID:          s.TenantID,
					Action:            "org.conversation.message-sent",
					EntityType:        "org_conversation",
					EntityID:          dbvalue.FormatUUID(conversationID),
					ActorType:         "org_user",
					ActorID:           dbvalue.Text(dbvalue.FormatUUID(identity.UserID)),
					SubjectHubUserDid: hubDID,
					SubjectOrgDid:     identity.OrgDID,
					Source:            "orgs-api",
					IdempotencyKey:    dbvalue.Text(string(key)),
					Payload:           msgAuditPayload,
				}); err != nil {
					return result{}, nil, fmt.Errorf("insert message audit event: %w", err)
				}

				if err := agencycontacts.EnqueuePointer(ctx, q, agencycontacts.Pointer{
					ContactID:         contactID,
					OrgDID:            identity.OrgDID,
					HubUserDID:        hubDID,
					Version:           pointerVersion,
					Present:           true,
					HasConversation:   true,
					AgencyDisplayName: agency.DisplayName,
					AgencyDomain:      orgs.OrgDomain(agency.Domain),
					AgencyLogoMediaID: agencyLogo,
					LastActivityAt:    &now,
					Suggestions:       suggestionList,
					NewAgencyMessage:  true,
				}); err != nil {
					return result{}, nil, fmt.Errorf("enqueue pointer: %w", err)
				}

				detail := contacts.ConversationDetail{
					Conversation: summaryFromConvRow(convRow),
					Messages: []contacts.ConversationMessage{
						messageFromMsgRow(msgRow),
					},
				}
				return result{Status: http.StatusOK, Body: detail}, nil, nil
			})
	}
}

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
			s.Problem(r.Context(), w, orgsproblem.ContactNotFoundError)
			return
		}

		if request.Suggestion != nil {
			if !validateSuggestion(r.Context(), s, identity.OrgDID, *request.Suggestion, w) {
				return
			}
		}

		now := s.CurrentTime()
		type result = handlerauth.Result[contacts.ConversationMessage]
		handlerauth.RunIdempotent(s, w, r, "orgs:send-message",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(replayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				fail := func(details problem.Body) (result, *handlerauth.Problem, error) {
					return handlerauth.Failure[contacts.ConversationMessage](details)
				}

				contact, err := q.LockOrgContact(ctx, sqlc.LockOrgContactParams{
					OrgDid: identity.OrgDID, ContactID: contactID,
				})
				if errors.Is(err, pgx.ErrNoRows) {
					return fail(orgsproblem.ContactNotFoundError)
				}
				if err != nil {
					return result{}, nil, fmt.Errorf("lock contact: %w", err)
				}

				conv, err := q.GetOrgConversationByContact(ctx, contactID)
				if errors.Is(err, pgx.ErrNoRows) {
					return fail(orgsproblem.ConversationNotFoundError)
				}
				if err != nil {
					return result{}, nil, fmt.Errorf("get conversation: %w", err)
				}

				if conv.PartyDeletedAt.Valid ||
					(conv.ReadOnlyReason.Valid && (conv.ReadOnlyReason.String == "agency_deleted" || conv.ReadOnlyReason.String == "hub_user_deleted")) {
					return fail(orgsproblem.ConversationPartyDeletedError)
				}
				if contact.MessagesOff || (conv.ReadOnlyReason.Valid && conv.ReadOnlyReason.String == "messages_off") {
					return fail(orgsproblem.AgencyMessagesOffError)
				}

				userInfo, err := q.GetOrgMyInfo(ctx, identity.UserID)
				if err != nil {
					return result{}, nil, fmt.Errorf("get user info: %w", err)
				}
				userDisplayName := userInfo.DisplayName
				if userDisplayName == "" {
					userDisplayName = userInfo.EmailAddress
				}
				agency, err := q.GetAgencyDetails(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, fmt.Errorf("get agency details: %w", err)
				}
				var agencyLogo *string
				if agency.LogoMediaID.Valid {
					str := dbvalue.FormatUUID(agency.LogoMediaID)
					agencyLogo = &str
				}

				messageID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}

				msgKind := "text"
				var msgText pgtype.Text
				var consumerDomain pgtype.Text
				var openingNumber pgtype.Int4

				if request.Suggestion != nil {
					msgKind = "suggestion"
					consumerDomain = dbvalue.Text(string(request.Suggestion.ConsumerDomain))
					openingNumber = pgtype.Int4{Int32: int32(request.Suggestion.OpeningNumber), Valid: true}
				} else if request.Text != nil {
					msgText = dbvalue.Text(string(*request.Text))
				}

				msgRow, err := q.InsertOrgConversationMessage(ctx, sqlc.InsertOrgConversationMessageParams{
					MessageID:         messageID,
					ConversationID:    conv.ConversationID,
					SenderType:        "agency",
					SenderUserID:      identity.UserID,
					SenderDisplayName: userDisplayName,
					Kind:              msgKind,
					MessageText:       msgText,
					ConsumerDomain:    consumerDomain,
					OpeningNumber:     openingNumber,
					SentAt:            pgtype.Timestamptz{Time: now, Valid: true},
				})
				if err != nil {
					return result{}, nil, fmt.Errorf("insert message: %w", err)
				}

				if _, err := q.UpdateOrgConversationOnMessage(ctx, sqlc.UpdateOrgConversationOnMessageParams{
					ConversationID:       conv.ConversationID,
					LastActivityAt:       pgtype.Timestamptz{Time: now, Valid: true},
					RecordedHubUserName:  conv.RecordedHubUserName,
					RecordedAgencyName:   agency.DisplayName,
					RecordedAgencyDomain: agency.Domain,
					AgencyUnread:         false,
				}); err != nil {
					return result{}, nil, fmt.Errorf("update conversation on message: %w", err)
				}

				cTouch, err := q.TouchOrgContactPointer(ctx, sqlc.TouchOrgContactPointerParams{
					ContactID:      contactID,
					LastActivityAt: pgtype.Timestamptz{Time: now, Valid: true},
				})
				if err != nil {
					return result{}, nil, fmt.Errorf("touch contact pointer: %w", err)
				}

				auditPayload, _ := json.Marshal(map[string]any{
					"action":     "message-sent",
					"message_id": dbvalue.FormatUUID(messageID),
				})
				if err := q.InsertAuditEvent(ctx, sqlc.InsertAuditEventParams{
					TenantID:          s.TenantID,
					Action:            "org.conversation.message-sent",
					EntityType:        "org_conversation",
					EntityID:          dbvalue.FormatUUID(conv.ConversationID),
					ActorType:         "org_user",
					ActorID:           dbvalue.Text(dbvalue.FormatUUID(identity.UserID)),
					SubjectHubUserDid: contact.HubUserDid,
					SubjectOrgDid:     identity.OrgDID,
					Source:            "orgs-api",
					IdempotencyKey:    dbvalue.Text(string(key)),
					Payload:           auditPayload,
				}); err != nil {
					return result{}, nil, fmt.Errorf("insert audit event: %w", err)
				}

				// Collect all suggestions for pointer update
				allMsgs, err := q.ListOrgConversationMessages(ctx, conv.ConversationID)
				if err != nil {
					return result{}, nil, fmt.Errorf("list conversation messages: %w", err)
				}
				suggestions := make([]contacts.OpeningSuggestion, 0)
				for _, m := range allMsgs {
					if m.Kind == "suggestion" && m.ConsumerDomain.Valid && m.OpeningNumber.Valid {
						suggestions = append(suggestions, contacts.OpeningSuggestion{
							ConsumerDomain: orgs.OrgDomain(m.ConsumerDomain.String),
							OpeningNumber:  orgopenings.OpeningNumber(m.OpeningNumber.Int32),
						})
					}
				}

				if err := agencycontacts.EnqueuePointer(ctx, q, agencycontacts.Pointer{
					ContactID:         contactID,
					OrgDID:            identity.OrgDID,
					HubUserDID:        contact.HubUserDid,
					Version:           cTouch.PointerVersion,
					Present:           true,
					HasConversation:   true,
					AgencyDisplayName: agency.DisplayName,
					AgencyDomain:      orgs.OrgDomain(agency.Domain),
					AgencyLogoMediaID: agencyLogo,
					LastActivityAt:    &now,
					Suggestions:       suggestions,
					NewAgencyMessage:  true,
				}); err != nil {
					return result{}, nil, fmt.Errorf("enqueue pointer: %w", err)
				}

				return result{Status: http.StatusOK, Body: messageFromMsgRow(msgRow)}, nil, nil
			})
	}
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
			s.Problem(r.Context(), w, orgsproblem.ContactNotFoundError)
			return
		}

		_, err = s.Queries.GetOrgContact(r.Context(), sqlc.GetOrgContactParams{
			OrgDid: identity.OrgDID, ContactID: contactID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.ContactNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get contact", err)
			return
		}

		conv, err := s.Queries.GetOrgConversationByContact(r.Context(), contactID)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get conversation", err)
			return
		}

		msgs, err := s.Queries.ListOrgConversationMessages(r.Context(), conv.ConversationID)
		if err != nil {
			s.InternalError(r.Context(), w, "list conversation messages", err)
			return
		}

		resultMsgs := make([]contacts.ConversationMessage, 0, len(msgs))
		for _, m := range msgs {
			resultMsgs = append(resultMsgs, messageFromMsgRow(m))
		}

		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, contacts.ConversationDetail{
			Conversation: summaryFromConvRow(conv),
			Messages:     resultMsgs,
		})
	}
}

func MarkConversationRead(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.MarkConversationReadRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		contactID, err := dbvalue.ParseUUID(string(request.ContactID))
		if err != nil {
			s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
			return
		}

		_, err = s.Queries.GetOrgContact(r.Context(), sqlc.GetOrgContactParams{
			OrgDid: identity.OrgDID, ContactID: contactID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get contact", err)
			return
		}

		_, err = s.Queries.MarkOrgConversationRead(r.Context(), contactID)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "mark conversation read", err)
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		s.Empty(r.Context(), w, http.StatusOK)
	}
}

func validateSuggestion(
	ctx context.Context, s *orgsruntime.Server, orgDID pgtype.UUID,
	suggestion contacts.OpeningSuggestion, w http.ResponseWriter,
) bool {
	isActive, err := s.Queries.CheckActiveSourcingEngagement(ctx, sqlc.CheckActiveSourcingEngagementParams{
		ProviderOrgDid: orgDID,
		ConsumerDomain: string(suggestion.ConsumerDomain),
	})
	if err != nil {
		s.InternalError(ctx, w, "check active sourcing engagement", err)
		return false
	}
	if !isActive {
		details := problem.ValidationFailedError
		details.Fields = []string{"suggestion"}
		s.Problem(ctx, w, details)
		return false
	}

	outcome, err := s.Openings.RelayGet(ctx, openingsspec.GetOrgOpeningRequest{
		Domain:        suggestion.ConsumerDomain,
		OpeningNumber: openingsspec.OpeningNumber(suggestion.OpeningNumber),
	})
	if err != nil {
		s.Problem(ctx, w, orgsproblem.TenantUnavailableError)
		return false
	}
	if outcome.Problem != nil || outcome.Result == nil || outcome.Result.Opening.State != "published" {
		details := problem.ValidationFailedError
		details.Fields = []string{"suggestion"}
		s.Problem(ctx, w, details)
		return false
	}
	return true
}

func postMessage(
	ctx context.Context, s *orgsruntime.Server, q *sqlc.Queries,
	identity middleware.OrgIdentity, key common.IdempotencyKey,
	conversationID, contactID, hubDID pgtype.UUID,
	agencyName, agencyDomain string, agencyLogo *string,
	hubUserName, hubUserHandle, userDisplayName string,
	text *contacts.MessageText, suggestion *contacts.OpeningSuggestion,
	now time.Time,
) (contacts.ConversationDetail, *handlerauth.Problem, error) {
	messageID, err := dbvalue.NewUUIDv7(now)
	if err != nil {
		return contacts.ConversationDetail{}, nil, err
	}

	msgKind := "text"
	var msgText pgtype.Text
	var consumerDomain pgtype.Text
	var openingNumber pgtype.Int4

	if suggestion != nil {
		msgKind = "suggestion"
		consumerDomain = dbvalue.Text(string(suggestion.ConsumerDomain))
		openingNumber = pgtype.Int4{Int32: int32(suggestion.OpeningNumber), Valid: true}
	} else if text != nil {
		msgText = dbvalue.Text(string(*text))
	}

	msgRow, err := q.InsertOrgConversationMessage(ctx, sqlc.InsertOrgConversationMessageParams{
		MessageID:         messageID,
		ConversationID:    conversationID,
		SenderType:        "agency",
		SenderUserID:      identity.UserID,
		SenderDisplayName: userDisplayName,
		Kind:              msgKind,
		MessageText:       msgText,
		ConsumerDomain:    consumerDomain,
		OpeningNumber:     openingNumber,
		SentAt:            pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return contacts.ConversationDetail{}, nil, fmt.Errorf("insert message: %w", err)
	}

	convRow, err := q.UpdateOrgConversationOnMessage(ctx, sqlc.UpdateOrgConversationOnMessageParams{
		ConversationID:       conversationID,
		LastActivityAt:       pgtype.Timestamptz{Time: now, Valid: true},
		RecordedHubUserName:  hubUserName,
		RecordedAgencyName:   agencyName,
		RecordedAgencyDomain: agencyDomain,
		AgencyUnread:         false,
	})
	if err != nil {
		return contacts.ConversationDetail{}, nil, fmt.Errorf("update conversation on message: %w", err)
	}

	cTouch, err := q.TouchOrgContactPointer(ctx, sqlc.TouchOrgContactPointerParams{
		ContactID:      contactID,
		LastActivityAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return contacts.ConversationDetail{}, nil, fmt.Errorf("touch contact pointer: %w", err)
	}

	auditPayload, _ := json.Marshal(map[string]any{
		"action":     "message-sent",
		"message_id": dbvalue.FormatUUID(messageID),
	})
	if err := q.InsertAuditEvent(ctx, sqlc.InsertAuditEventParams{
		TenantID:          s.TenantID,
		Action:            "org.conversation.message-sent",
		EntityType:        "org_conversation",
		EntityID:          dbvalue.FormatUUID(conversationID),
		ActorType:         "org_user",
		ActorID:           dbvalue.Text(dbvalue.FormatUUID(identity.UserID)),
		SubjectHubUserDid: hubDID,
		SubjectOrgDid:     identity.OrgDID,
		Source:            "orgs-api",
		IdempotencyKey:    dbvalue.Text(string(key)),
		Payload:           auditPayload,
	}); err != nil {
		return contacts.ConversationDetail{}, nil, fmt.Errorf("insert audit event: %w", err)
	}

	allMsgs, err := q.ListOrgConversationMessages(ctx, conversationID)
	if err != nil {
		return contacts.ConversationDetail{}, nil, fmt.Errorf("list conversation messages: %w", err)
	}
	suggestions := make([]contacts.OpeningSuggestion, 0)
	for _, m := range allMsgs {
		if m.Kind == "suggestion" && m.ConsumerDomain.Valid && m.OpeningNumber.Valid {
			suggestions = append(suggestions, contacts.OpeningSuggestion{
				ConsumerDomain: orgs.OrgDomain(m.ConsumerDomain.String),
				OpeningNumber:  orgopenings.OpeningNumber(m.OpeningNumber.Int32),
			})
		}
	}

	if err := agencycontacts.EnqueuePointer(ctx, q, agencycontacts.Pointer{
		ContactID:         contactID,
		OrgDID:            identity.OrgDID,
		HubUserDID:        hubDID,
		Version:           cTouch.PointerVersion,
		Present:           true,
		HasConversation:   true,
		AgencyDisplayName: agencyName,
		AgencyDomain:      orgs.OrgDomain(agencyDomain),
		AgencyLogoMediaID: agencyLogo,
		LastActivityAt:    &now,
		Suggestions:       suggestions,
		NewAgencyMessage:  true,
	}); err != nil {
		return contacts.ConversationDetail{}, nil, fmt.Errorf("enqueue pointer: %w", err)
	}

	resultMsgs := make([]contacts.ConversationMessage, 0, len(allMsgs))
	for _, m := range allMsgs {
		resultMsgs = append(resultMsgs, messageFromMsgRow(m))
	}
	_ = msgRow

	return contacts.ConversationDetail{
		Conversation: summaryFromConvRow(convRow),
		Messages:     resultMsgs,
	}, nil, nil
}

func summaryFromConvRow(row sqlc.VetchiumOrgConversation) contacts.ConversationSummary {
	s := contacts.ConversationSummary{
		ConversationID:        contacts.ConversationID(dbvalue.FormatUUID(row.ConversationID)),
		ContactID:             contacts.ContactID(dbvalue.FormatUUID(row.ContactID)),
		RecordedHubUserName:   row.RecordedHubUserName,
		RecordedHubUserHandle: hub.HubHandle(row.RecordedHubUserHandle),
		RecordedAgencyName:    row.RecordedAgencyName,
		RecordedAgencyDomain:  orgs.OrgDomain(row.RecordedAgencyDomain),
		AgencyUnread:          row.AgencyUnread,
		CreatedAt:             row.CreatedAt.Time.UTC(),
		LastActivityAt:        row.LastActivityAt.Time.UTC(),
	}
	if row.ReadOnlyReason.Valid {
		r := contacts.ConversationReadOnlyReason(row.ReadOnlyReason.String)
		s.ReadOnlyReason = &r
	}
	return s
}

func messageFromMsgRow(row sqlc.VetchiumOrgConversationMessage) contacts.ConversationMessage {
	msg := contacts.ConversationMessage{
		MessageID:         contacts.MessageID(dbvalue.FormatUUID(row.MessageID)),
		SenderType:        contacts.MessageSenderType(row.SenderType),
		SenderDisplayName: row.SenderDisplayName,
		Kind:              contacts.MessageKind(row.Kind),
		SentAt:            row.SentAt.Time.UTC(),
	}
	if row.MessageText.Valid {
		t := contacts.MessageText(row.MessageText.String)
		msg.Text = &t
	}
	if row.ConsumerDomain.Valid && row.OpeningNumber.Valid {
		msg.Suggestion = &contacts.OpeningSuggestion{
			ConsumerDomain: orgs.OrgDomain(row.ConsumerDomain.String),
			OpeningNumber:  orgopenings.OpeningNumber(row.OpeningNumber.Int32),
		}
	}
	return msg
}
