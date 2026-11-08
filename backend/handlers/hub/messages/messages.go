package messages

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
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

	"backend/internal/agencycontacts"
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
	AfterAgency     string    `json:"after_agency"`
}

// pointerByDomain reads the Hub user's pointer to the agency a portal names
// by its domain.
func pointerByDomain(
	r *http.Request, s *hubruntime.Server, hubDID pgtype.UUID, domain orgs.OrgDomain,
) (sqlc.GetHubAgencyPointerRow, error) {
	row, err := s.Queries.GetHubAgencyPointerByDomain(r.Context(),
		sqlc.GetHubAgencyPointerByDomainParams{
			HubUserDid: hubDID, AgencyDomain: string(domain),
		})
	return sqlc.GetHubAgencyPointerRow(row), err
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
			if !valid || json.Unmarshal(payload, &cursor) != nil ||
				cursor.AfterAgency == "" || cursor.AfterActivityAt.IsZero() {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterActivityAt = dbvalue.Timestamp(cursor.AfterActivityAt)
			params.AfterAgencyDomain = dbvalue.Text(cursor.AfterAgency)
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
					AfterAgency:     last.AgencyDomain,
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

			item, err := summary(s, listedPointer(row))
			if err != nil {
				s.InternalError(r.Context(), w, "read pointer", err)
				return
			}
			items = append(items, item)
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
		pointer, err := pointerByDomain(r, s, identity.UserDID, request.AgencyDomain)
		// A pair with only a request opens too: its note is read live.
		if errors.Is(err, pgx.ErrNoRows) || !pointer.HasConversation && !pointer.HasRequest {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get agency pointer", err)
			return
		}

		conversation, err := summary(s, detailedPointer(pointer))
		if err != nil {
			s.InternalError(r.Context(), w, "read pointer", err)
			return
		}
		// The Hub user's own request that the agency declined or let expire
		// still shows (MKT-HUB-001), but the agency's tenant has nothing left
		// to read for it.
		if latest := conversation.LatestRequest; !pointer.HasConversation &&
			latest != nil && latest.Direction == contacts.ToAgency &&
			(latest.State == contacts.ChatRequestDeclined ||
				latest.State == contacts.ChatRequestExpired) {
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusOK, hubmessages.HubConversationDetail{
				Conversation: conversation,
				Messages:     []contacts.ConversationMessage{},
			})
			return
		}

		limit := request.EffectiveLimit()
		outcome, err := s.Conversations.RelayRead(r.Context(), federationspec.MeshReadConversationRequest{
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

		if conversation.ReadOnlyReason == nil && outcome.Result.ReadOnlyReason != nil {
			conversation.ReadOnlyReason = outcome.Result.ReadOnlyReason
		}
		if pointer.HasConversation {
			// The live read is newer than the pointer.
			conversation.AgencyMayWriteUntil = outcome.Result.AgencyMayWriteUntil
			conversation.HubMayWriteUntil = outcome.Result.HubMayWriteUntil
		}

		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, hubmessages.HubConversationDetail{
			Conversation:       conversation,
			Messages:           outcome.Result.Messages,
			PendingRequestNote: outcome.Result.PendingRequestNote,
			NextPaginationKey:  outcome.Result.NextPaginationKey,
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
		pointer, err := pointerByDomain(r, s, identity.UserDID, request.AgencyDomain)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && !pointer.HasConversation {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get agency pointer", err)
			return
		}

		if pointer.ReadOnlyReason.Valid {
			s.Problem(r.Context(), w, hubproblem.HubConversationPartyDeletedError)
			return
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
			AgencyOrgDID:       orgs.OrgDID(dbvalue.FormatUUID(pointer.AgencyOrgDid)),
			HubUserDID:         hub.HubUserDID(dbvalue.FormatUUID(identity.UserDID)),
			HubUserDisplayName: common.DisplayName(me.DisplayName),
			HubUserHandle:      hub.HubHandle(me.Handle),
			Text:               request.Text,
			WindowSeconds:      int64(s.ConversationWindow / time.Second),
		}

		outcome, err := s.Commands.Send(r.Context(), commands.Request{
			Kind: federationspec.HubConversationReplyKind,
			Authority: commands.Principal{
				Type: directoryspec.PrincipalOrg, DID: pointer.AgencyOrgDid,
			},
			AggregateID: federationspec.ContactAggregateID(payload.AgencyOrgDID, payload.HubUserDID),
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

// DeleteMessage deletes one of the Hub user's own text messages
// (MKT-CNV-007). The agency keeps a "Message deleted" stub without the text;
// only this tenant's audit keeps what the Hub user wrote, read live just
// before the command leaves. A repeated request replays the command without
// reading again.
//
//vetchium:multiple-commits reads the message live, sends the federation command to the agency authority, then audits the deletion locally
func DeleteMessage(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.DeleteMessageRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		pointer, err := pointerByDomain(r, s, identity.UserDID, request.AgencyDomain)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && !pointer.HasConversation {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get agency pointer", err)
			return
		}
		payload := federationspec.HubConversationMessageDeletePayload{
			AgencyOrgDID:  orgs.OrgDID(dbvalue.FormatUUID(pointer.AgencyOrgDid)),
			HubUserDID:    hub.HubUserDID(dbvalue.FormatUUID(identity.UserDID)),
			MessageNumber: request.MessageNumber,
		}
		aggregate := federationspec.ContactAggregateID(payload.AgencyOrgDID, payload.HubUserDID)
		known, err := s.Commands.Known(r.Context(),
			federationspec.HubConversationMessageDeleteKind, aggregate, key)
		if err != nil {
			s.InternalError(r.Context(), w, "find message delete operation", err)
			return
		}
		var deletedText *contacts.MessageText
		if !known {
			number := request.MessageNumber
			outcome, err := s.Conversations.RelayRead(r.Context(), federationspec.MeshReadConversationRequest{
				HubUserDID: payload.HubUserDID, AgencyOrgDID: payload.AgencyOrgDID,
				MessageNumber: &number,
			})
			switch {
			case err == nil && outcome.Problem != nil &&
				outcome.Problem.Type == orgsproblem.ConversationNotFoundError.Type:
				s.Problem(r.Context(), w, hubproblem.HubConversationMessageNotFoundError)
				return
			case err != nil || outcome.Problem != nil || outcome.Result == nil ||
				len(outcome.Result.Messages) != 1:
				s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
				return
			}
			found := outcome.Result.Messages[0]
			if found.SenderType != contacts.MessageSenderTypeHubUser ||
				found.Kind != contacts.MessageKindText || found.Deleted || found.Text == nil {
				s.Problem(r.Context(), w, hubproblem.HubConversationMessageNotFoundError)
				return
			}
			deletedText = found.Text
		}

		digest, err := requestDigest(request)
		if err != nil {
			s.InternalError(r.Context(), w, "digest request", err)
			return
		}
		outcome, err := s.Commands.Send(r.Context(), commands.Request{
			Kind: federationspec.HubConversationMessageDeleteKind,
			Authority: commands.Principal{
				Type: directoryspec.PrincipalOrg, DID: pointer.AgencyOrgDid,
			},
			AggregateID: aggregate,
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
			s.InternalError(r.Context(), w, "send hub-conversation-message-delete", err)
			return
		}
		// The first send audits the deletion it asked for, accepted or still
		// pending; a rejected one deleted nothing.
		if deletedText != nil && (outcome.State == commands.StateSucceeded ||
			outcome.State == commands.StatePending) {
			rows, err := s.Queries.AuditHubAgencyMessageDeleted(r.Context(),
				sqlc.AuditHubAgencyMessageDeletedParams{
					TenantID: s.TenantID, AgencyDomain: pointer.AgencyDomain,
					ActorType: "hub_user", ActorID: dbvalue.FormatUUID(identity.UserDID),
					HubUserDid: identity.UserDID, Source: "hub-api",
					IdempotencyKey: dbvalue.Text(string(key)),
					MessageNumber:  int32(request.MessageNumber),
					DeletedBy:      string(contacts.MessageSenderTypeHubUser),
					DeletedText:    dbvalue.Text(string(*deletedText)),
				})
			if err != nil || rows != 1 {
				s.InternalError(r.Context(), w, "audit message deletion",
					fmt.Errorf("%d audit rows: %w", rows, err))
				return
			}
		}
		switch outcome.State {
		case commands.StateSucceeded:
			var msg contacts.ConversationMessage
			if err := json.Unmarshal(outcome.Response.Body, &msg); err != nil {
				s.InternalError(r.Context(), w, "decode deleted message", err)
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

func MarkConversationRead(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.MarkConversationReadRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		pointer, err := pointerByDomain(r, s, identity.UserDID, request.AgencyDomain)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && !pointer.HasConversation {
			s.Problem(r.Context(), w, hubproblem.HubConversationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get agency pointer", err)
			return
		}

		if _, err := s.Queries.MarkHubAgencyPointerRead(r.Context(), sqlc.MarkHubAgencyPointerReadParams{
			HubUserDid:   identity.UserDID,
			AgencyOrgDid: pointer.AgencyOrgDid,
			TenantID:     s.TenantID,
		}); err != nil {
			s.InternalError(r.Context(), w, "mark pointer read", err)
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		s.Empty(r.Context(), w, http.StatusOK)
	}
}

// CountAwaitingConversations counts the Hub user's conversations that await
// them: an agency's pending request or unread agency messages (MKT-HUB-001).
func CountAwaitingConversations(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		count, err := s.Queries.CountHubAwaitingConversations(r.Context(), identity.UserDID)
		if err != nil {
			s.InternalError(r.Context(), w, "count awaiting conversations", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, hubmessages.AwaitingConversationCount{Count: count})
	}
}

// pointerView is what a Hub summary reads from the agency pointer.
type pointerView struct {
	agencyName, agencyDomain string
	hasConversation          bool
	request, suggestions     []byte
	agencyUntil, hubUntil    pgtype.Timestamptz
	lastActivityAt           pgtype.Timestamptz
	unreadCount              int32
	readOnlyReason           pgtype.Text
}

func listedPointer(row sqlc.ListHubAgencyConversationsRow) pointerView {
	return pointerView{
		agencyName:   row.AgencyDisplayName,
		agencyDomain: row.AgencyDomain, hasConversation: row.HasConversation,
		request: row.Request, suggestions: row.Suggestions,
		agencyUntil: row.AgencyMayWriteUntil, hubUntil: row.HubMayWriteUntil,
		lastActivityAt: row.LastActivityAt, unreadCount: row.UnreadCount,
		readOnlyReason: row.ReadOnlyReason,
	}
}

func detailedPointer(row sqlc.GetHubAgencyPointerRow) pointerView {
	return pointerView{
		agencyName:   row.AgencyDisplayName,
		agencyDomain: row.AgencyDomain, hasConversation: row.HasConversation,
		request: row.Request, suggestions: row.Suggestions,
		agencyUntil: row.AgencyMayWriteUntil, hubUntil: row.HubMayWriteUntil,
		lastActivityAt: row.LastActivityAt, unreadCount: row.UnreadCount,
		readOnlyReason: row.ReadOnlyReason,
	}
}

// summary is the Hub view of a pointer; a write-until instant that has
// passed is left out (MKT-REQ-004).
func summary(s *hubruntime.Server, view pointerView) (hubmessages.HubConversationSummary, error) {
	suggestions := []hubmessages.HubOpeningSuggestion{}
	if len(view.suggestions) > 0 {
		if err := json.Unmarshal(view.suggestions, &suggestions); err != nil {
			return hubmessages.HubConversationSummary{}, fmt.Errorf("decode suggestions: %w", err)
		}
	}
	result := hubmessages.HubConversationSummary{
		AgencyDisplayName: view.agencyName,
		AgencyDomain:      orgs.OrgDomain(view.agencyDomain),
		HasConversation:   view.hasConversation,
		Unread:            view.unreadCount > 0,
		UnreadCount:       view.unreadCount,
		Suggestions:       suggestions,
		LastActivityAt:    view.lastActivityAt.Time.UTC(),
	}
	if view.readOnlyReason.Valid {
		reason := contacts.ConversationReadOnlyReason(view.readOnlyReason.String)
		result.ReadOnlyReason = &reason
	}
	window := agencycontacts.WriteWindow{
		AgencyUntil: instant(view.agencyUntil), HubUntil: instant(view.hubUntil),
	}.Open(s.CurrentTime())
	result.AgencyMayWriteUntil, result.HubMayWriteUntil = window.AgencyUntil, window.HubUntil
	if view.request != nil {
		latest, err := chatRequest(s, view.agencyName, view.agencyDomain, view.request)
		if err != nil {
			return hubmessages.HubConversationSummary{}, err
		}
		result.LatestRequest = &latest
	}
	return result, nil
}

func instant(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	at := value.Time.UTC()
	return &at
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
		case hubproblem.HubConversationMessageNotFoundError.Type:
			s.Problem(r.Context(), w, hubproblem.HubConversationMessageNotFoundError)
			return
		case hubproblem.HubConversationPartyDeletedError.Type:
			s.Problem(r.Context(), w, hubproblem.HubConversationPartyDeletedError)
			return
		case hubproblem.HubChatRequestNotFoundError.Type:
			s.Problem(r.Context(), w, hubproblem.HubChatRequestNotFoundError)
			return
		case hubproblem.HubConversationClosedError.Type:
			s.Problem(r.Context(), w, hubproblem.HubConversationClosedError)
			return
		case hubproblem.HubAgencyNotAssignedError.Type:
			s.Problem(r.Context(), w, hubproblem.HubAgencyNotAssignedError)
			return
		case hubproblem.HubChatRequestExistsError.Type:
			s.Problem(r.Context(), w, hubproblem.HubChatRequestExistsError)
			return
		case hubproblem.HubConversationOpenError.Type:
			s.Problem(r.Context(), w, hubproblem.HubConversationOpenError)
			return
		case hubproblem.HubChatRequestBlockedError.Type:
			s.Problem(r.Context(), w, hubproblem.HubChatRequestBlockedError)
			return
		}
	}
	s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
}
