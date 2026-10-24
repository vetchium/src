package messages

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	hubmessages "github.com/vetchium/src/typespec/hub/messages"
	operationspec "github.com/vetchium/src/typespec/hub/operations"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

const listPaginationPurpose = "hub:conversations:list"

type listCursor struct {
	AfterActivityAt time.Time `json:"after_activity_at"`
	AfterContactID  string    `json:"after_contact_id"`
}

func ListConversations(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.ListConversationsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		limit := request.EffectiveLimit()

		params := sqlc.ListHubAgencyConversationsParams{
			HubUserDid: identity.UserDID,
			PageLimit:  limit + 1,
		}

		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), listPaginationPurpose,
				string(*request.PaginationKey),
			)
			var cursor listCursor
			var afterContact pgtype.UUID
			if valid && json.Unmarshal(payload, &cursor) == nil {
				afterContact, _ = dbvalue.ParseUUID(cursor.AfterContactID)
			}
			if !afterContact.Valid || cursor.AfterActivityAt.IsZero() {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterActivityAt = dbvalue.Timestamp(cursor.AfterActivityAt)
			params.AfterContactID = afterContact
		}

		rows, err := s.Queries.ListHubAgencyConversations(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list conversations", err)
			return
		}

		items := make([]hubmessages.HubConversationSummary, 0, len(rows))
		for index, row := range rows {
			if int32(index) == limit {
				last := rows[index-1]
				payload, err := json.Marshal(listCursor{
					AfterActivityAt: last.LastActivityAt.Time.UTC(),
					AfterContactID:  dbvalue.FormatUUID(last.ContactID),
				})
				if err != nil {
					s.InternalError(r.Context(), w, "encode pagination key", err)
					return
				}
				key := common.PaginationKey(credentials.SignValue(
					s.CredentialSubkey("pagination"), listPaginationPurpose,
					payload,
				))
				w.Header().Set("Cache-Control", "no-store")
				s.JSON(r.Context(), w, http.StatusOK, hubmessages.ListConversationsResponse{
					Items:             items,
					NextPaginationKey: &key,
				})
				return
			}

			items = append(items, summaryFromPointerRow(row))
		}

		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, hubmessages.ListConversationsResponse{
			Items: items,
		})
	}
}

func GetConversation(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.GetConversationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		contactID, err := dbvalue.ParseUUID(string(request.ContactID))
		if err != nil {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}

		pointer, err := s.Queries.GetHubAgencyPointer(r.Context(), sqlc.GetHubAgencyPointerParams{
			ContactID:  contactID,
			HubUserDid: identity.UserDID,
		})
		if errors.Is(err, pgx.ErrNoRows) || !pointer.HasConversation {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get agency pointer", err)
			return
		}

		limit := request.EffectiveLimit()
		outcome, err := s.Conversations.RelayRead(r.Context(), federationspec.MeshReadConversationRequest{
			ContactID:     request.ContactID,
			HubUserDID:    hub.HubUserDID(dbvalue.FormatUUID(identity.UserDID)),
			AgencyOrgDID:  orgs.OrgDID(dbvalue.FormatUUID(pointer.AgencyOrgDid)),
			PaginationKey: request.PaginationKey,
			Limit:         &limit,
		})
		switch {
		case err == nil && outcome.Problem != nil &&
			outcome.Problem.Type == orgsproblem.ConversationNotFoundError.Type:
			// The pointer has not yet heard that the conversation is gone.
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		case err == nil && outcome.Problem != nil &&
			outcome.Problem.Type == problem.InvalidPaginationKeyError.Type:
			s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
			return
		case err != nil || outcome.Problem != nil || outcome.Result == nil:
			s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
			return
		}

		summary := summaryFromPointerDetailRow(pointer)
		if summary.ReadOnlyReason == nil && outcome.Result.ReadOnlyReason != nil {
			summary.ReadOnlyReason = outcome.Result.ReadOnlyReason
		}

		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, hubmessages.HubConversationDetail{
			Conversation:      summary,
			Messages:          outcome.Result.Messages,
			NextPaginationKey: outcome.Result.NextPaginationKey,
		})
	}
}

func ReplyToConversation(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.ReplyToConversationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		contactID, err := dbvalue.ParseUUID(string(request.ContactID))
		if err != nil {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}

		pointer, err := s.Queries.GetHubAgencyPointer(r.Context(), sqlc.GetHubAgencyPointerParams{
			ContactID:  contactID,
			HubUserDid: identity.UserDID,
		})
		if errors.Is(err, pgx.ErrNoRows) || !pointer.HasConversation {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get agency pointer", err)
			return
		}

		if pointer.ReadOnlyReason.Valid {
			switch pointer.ReadOnlyReason.String {
			case "agency_deleted", "hub_user_deleted":
				s.Problem(r.Context(), w, hubproblem.HubConversationPartyDeletedError)
				return
			case "messages_off":
				s.Problem(r.Context(), w, hubproblem.HubAgencyMessagesOffError)
				return
			}
		}

		digest, err := requestDigest(request)
		if err != nil {
			s.InternalError(r.Context(), w, "digest request", err)
			return
		}

		me, err := s.Queries.GetHubPublicProfile(r.Context(), identity.UserDID)
		if err != nil {
			s.InternalError(r.Context(), w, "read Hub profile", err)
			return
		}
		payload := federationspec.HubConversationReplyPayload{
			ContactID:          request.ContactID,
			HubUserDID:         hub.HubUserDID(dbvalue.FormatUUID(identity.UserDID)),
			HubUserDisplayName: common.DisplayName(me.DisplayName),
			HubUserHandle:      hub.HubHandle(me.Handle),
			Text:               request.Text,
		}

		outcome, err := s.Commands.Send(r.Context(), commands.Request{
			Kind: federationspec.HubConversationReplyKind,
			Authority: commands.Principal{
				Type: directoryspec.PrincipalOrg, DID: pointer.AgencyOrgDid,
			},
			AggregateID: string(request.ContactID),
			Owner: commands.Owner{
				Type: commands.OwnerHubUser, ID: dbvalue.FormatUUID(identity.UserDID),
			},
			IdempotencyKey: key,
			RequestDigest:  digest,
			Payload:        payload,
		})
		if errors.Is(err, commands.ErrIdempotencyConflict) {
			s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "send hub-conversation-reply", err)
			return
		}

		switch outcome.State {
		case commands.StateSucceeded:
			var msg contacts.ConversationMessage
			if err := json.Unmarshal(outcome.Response.Body, &msg); err != nil {
				s.InternalError(r.Context(), w, "decode message result", err)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusOK, msg)
		case commands.StateFailed:
			writeRejection(s, w, r, outcome.Response)
		case commands.StatePending:
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusAccepted, operationspec.PendingOperation{
				OperationID: operationspec.OperationID(dbvalue.FormatUUID(outcome.OperationID)),
			})
		default:
			s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
		}
	}
}

//vetchium:multiple-commits sends the federation command to the agency authority, then updates the local pointer on success
func DeleteConversation(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.DeleteConversationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		contactID, err := dbvalue.ParseUUID(string(request.ContactID))
		if err != nil {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}

		pointer, err := s.Queries.GetHubAgencyPointer(r.Context(), sqlc.GetHubAgencyPointerParams{
			ContactID:  contactID,
			HubUserDid: identity.UserDID,
		})
		if errors.Is(err, pgx.ErrNoRows) || !pointer.HasConversation {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get agency pointer", err)
			return
		}

		digest, err := requestDigest(request)
		if err != nil {
			s.InternalError(r.Context(), w, "digest request", err)
			return
		}

		payload := federationspec.HubConversationDeletePayload{
			ContactID:  request.ContactID,
			HubUserDID: hub.HubUserDID(dbvalue.FormatUUID(identity.UserDID)),
		}

		outcome, err := s.Commands.Send(r.Context(), commands.Request{
			Kind: federationspec.HubConversationDeleteKind,
			Authority: commands.Principal{
				Type: directoryspec.PrincipalOrg, DID: pointer.AgencyOrgDid,
			},
			AggregateID: string(request.ContactID),
			Owner: commands.Owner{
				Type: commands.OwnerHubUser, ID: dbvalue.FormatUUID(identity.UserDID),
			},
			IdempotencyKey: key,
			RequestDigest:  digest,
			Payload:        payload,
		})
		if errors.Is(err, commands.ErrIdempotencyConflict) {
			s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "send hub-conversation-delete", err)
			return
		}

		switch outcome.State {
		case commands.StateSucceeded:
			// The agency's pointer event follows; hiding the conversation now
			// keeps the list consistent with the answer. A replay repeats it.
			if _, err := s.Queries.MarkHubAgencyPointerConversationDeleted(r.Context(), sqlc.MarkHubAgencyPointerConversationDeletedParams{
				ContactID:  contactID,
				HubUserDid: identity.UserDID,
				TenantID:   s.TenantID,
			}); err != nil {
				s.InternalError(r.Context(), w, "hide deleted conversation", err)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			s.Empty(r.Context(), w, http.StatusOK)
		case commands.StateFailed:
			writeRejection(s, w, r, outcome.Response)
		case commands.StatePending:
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusAccepted, operationspec.PendingOperation{
				OperationID: operationspec.OperationID(dbvalue.FormatUUID(outcome.OperationID)),
			})
		default:
			s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
		}
	}
}

func MarkConversationRead(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.MarkConversationReadRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		contactID, err := dbvalue.ParseUUID(string(request.ContactID))
		if err != nil {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}

		pointer, err := s.Queries.GetHubAgencyPointer(r.Context(), sqlc.GetHubAgencyPointerParams{
			ContactID:  contactID,
			HubUserDid: identity.UserDID,
		})
		if errors.Is(err, pgx.ErrNoRows) || !pointer.HasConversation {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get agency pointer", err)
			return
		}

		if _, err := s.Queries.MarkHubAgencyPointerRead(r.Context(), sqlc.MarkHubAgencyPointerReadParams{
			ContactID:  contactID,
			HubUserDid: identity.UserDID,
			TenantID:   s.TenantID,
		}); err != nil {
			s.InternalError(r.Context(), w, "mark pointer read", err)
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		s.Empty(r.Context(), w, http.StatusOK)
	}
}

func summaryFromPointerRow(row sqlc.ListHubAgencyConversationsRow) hubmessages.HubConversationSummary {
	var suggestions []hubmessages.HubOpeningSuggestion
	_ = json.Unmarshal(row.Suggestions, &suggestions)
	if suggestions == nil {
		suggestions = []hubmessages.HubOpeningSuggestion{}
	}

	var readOnly *contacts.ConversationReadOnlyReason
	if row.ReadOnlyReason.Valid {
		r := contacts.ConversationReadOnlyReason(row.ReadOnlyReason.String)
		readOnly = &r
	}

	return hubmessages.HubConversationSummary{
		ContactID:         contacts.ContactID(dbvalue.FormatUUID(row.ContactID)),
		AgencyDisplayName: row.AgencyDisplayName,
		AgencyDomain:      orgs.OrgDomain(row.AgencyDomain),
		HasConversation:   row.HasConversation,
		Unread:            row.UnreadCount > 0,
		UnreadCount:       row.UnreadCount,
		ReadOnlyReason:    readOnly,
		Suggestions:       suggestions,
		LastActivityAt:    row.LastActivityAt.Time.UTC(),
	}
}

func summaryFromPointerDetailRow(row sqlc.GetHubAgencyPointerRow) hubmessages.HubConversationSummary {
	var suggestions []hubmessages.HubOpeningSuggestion
	_ = json.Unmarshal(row.Suggestions, &suggestions)
	if suggestions == nil {
		suggestions = []hubmessages.HubOpeningSuggestion{}
	}

	var readOnly *contacts.ConversationReadOnlyReason
	if row.ReadOnlyReason.Valid {
		r := contacts.ConversationReadOnlyReason(row.ReadOnlyReason.String)
		readOnly = &r
	}

	return hubmessages.HubConversationSummary{
		ContactID:         contacts.ContactID(dbvalue.FormatUUID(row.ContactID)),
		AgencyDisplayName: row.AgencyDisplayName,
		AgencyDomain:      orgs.OrgDomain(row.AgencyDomain),
		HasConversation:   row.HasConversation,
		Unread:            row.UnreadCount > 0,
		UnreadCount:       row.UnreadCount,
		ReadOnlyReason:    readOnly,
		Suggestions:       suggestions,
		LastActivityAt:    row.LastActivityAt.Time.UTC(),
	}
}

func requestDigest(request any) ([]byte, error) {
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(data)
	return sum[:], nil
}

func writeRejection(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	response commands.Response,
) {
	var details problem.Details
	if err := json.Unmarshal(response.Body, &details); err == nil {
		switch details.Type {
		case hubproblem.HubConversationNotFoundError.Type:
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		case hubproblem.HubAgencyMessagesOffError.Type:
			s.Problem(r.Context(), w, hubproblem.HubAgencyMessagesOffError)
			return
		case hubproblem.HubConversationPartyDeletedError.Type:
			s.Problem(r.Context(), w, hubproblem.HubConversationPartyDeletedError)
			return
		}
	}
	s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
}
