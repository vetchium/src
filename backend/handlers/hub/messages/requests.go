package messages

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	hubmessages "github.com/vetchium/src/typespec/hub/messages"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	operationspec "github.com/vetchium/src/typespec/hub/operations"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

const requestsPurpose = "hub:chat-requests:list"

// windowDays is the Hub tenant's conversation window in whole days.
func windowDays(s *hubruntime.Server) int32 {
	return int32(s.ConversationWindow / (24 * time.Hour))
}

// chatRequest is the Hub view of the request a pointer keeps; the pointer
// never holds the note (MKT-DAT-003).
func chatRequest(
	s *hubruntime.Server, contactID pgtype.UUID, agencyName, agencyDomain string,
	stored []byte,
) (hubmessages.HubChatRequest, error) {
	var request federationspec.AgencyPointerRequest
	if err := json.Unmarshal(stored, &request); err != nil {
		return hubmessages.HubChatRequest{}, fmt.Errorf("decode pointer request: %w", err)
	}
	return hubChatRequest(s, contactID, agencyName, agencyDomain, request), nil
}

func hubChatRequest(
	s *hubruntime.Server, contactID pgtype.UUID, agencyName, agencyDomain string,
	request federationspec.AgencyPointerRequest,
) hubmessages.HubChatRequest {
	return hubmessages.HubChatRequest{
		RequestID: request.RequestID,
		ContactID: contacts.ContactID(dbvalue.FormatUUID(contactID)),
		Direction: request.Direction,
		State:     request.State,
		Opening: contacts.OpeningSuggestion{
			ConsumerDomain: request.ConsumerDomain,
			OpeningNumber:  request.OpeningNumber,
		},
		AgencyDisplayName: agencyName,
		AgencyDomain:      orgs.OrgDomain(agencyDomain),
		SentAt:            request.SentAt,
		AnsweredAt:        request.AnsweredAt,
		DeclineScope:      request.DeclineScope,
		BlockedUntil:      request.BlockedUntil,
		WindowDays:        windowDays(s),
	}
}

type requestCursor struct {
	HubUser   string     `json:"hub_user"`
	Direction string     `json:"direction"`
	Answered  bool       `json:"answered"`
	At        *time.Time `json:"at,omitempty"`
	ContactID string     `json:"contact_id,omitempty"`
}

func signRequests(s *hubruntime.Server, cursor requestCursor) (common.PaginationKey, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return common.PaginationKey(credentials.SignValue(
		s.CredentialSubkey("pagination"), requestsPurpose, payload)), nil
}

func verifyRequests(
	s *hubruntime.Server, key common.PaginationKey, hubUser, direction string,
) (requestCursor, bool) {
	payload, valid := credentials.VerifySignedValue(
		s.CredentialSubkey("pagination"), requestsPurpose, string(key))
	var cursor requestCursor
	if !valid || json.Unmarshal(payload, &cursor) != nil ||
		cursor.HubUser != hubUser || cursor.Direction != direction ||
		(cursor.At == nil) != (cursor.ContactID == "") ||
		(!cursor.Answered && cursor.At == nil) {
		return requestCursor{}, false
	}
	if cursor.At != nil {
		if _, err := dbvalue.ParseUUID(cursor.ContactID); err != nil {
			return requestCursor{}, false
		}
	}
	return cursor, true
}

// ListChatRequests lists the Hub user's latest request with each agency in
// one direction: pending ones oldest first, then answered ones newest answer
// first.
func ListChatRequests(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.ListHubChatRequestsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		hubUser, direction := dbvalue.FormatUUID(identity.UserDID), string(request.Direction)
		var cursor *requestCursor
		if request.PaginationKey != nil {
			found, valid := verifyRequests(s, *request.PaginationKey, hubUser, direction)
			if !valid {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			cursor = &found
		}
		limit := int(request.EffectiveLimit())
		response := hubmessages.ListHubChatRequestsResponse{Items: []hubmessages.HubChatRequest{}}
		var next *requestCursor
		if cursor == nil || !cursor.Answered {
			params := sqlc.ListHubPendingChatRequestsParams{
				HubUserDid: identity.UserDID, Direction: direction,
				PageLimit: int32(limit + 1),
			}
			if cursor != nil {
				params.AfterSentAt = dbvalue.Timestamp(*cursor.At)
				params.AfterContactID, _ = dbvalue.ParseUUID(cursor.ContactID)
			}
			rows, err := s.Queries.ListHubPendingChatRequests(r.Context(), params)
			if err != nil {
				s.InternalError(r.Context(), w, "list pending chat requests", err)
				return
			}
			for index, row := range rows {
				if index == limit {
					last := rows[index-1]
					at := last.SentAt.Time.UTC()
					next = &requestCursor{At: &at, ContactID: dbvalue.FormatUUID(last.ContactID)}
					break
				}
				item, err := chatRequest(s, row.ContactID, row.AgencyDisplayName,
					row.AgencyDomain, row.Request)
				if err != nil {
					s.InternalError(r.Context(), w, "read pending chat request", err)
					return
				}
				response.Items = append(response.Items, item)
			}
		}
		if next == nil {
			remaining := limit - len(response.Items)
			params := sqlc.ListHubAnsweredChatRequestsParams{
				HubUserDid: identity.UserDID, Direction: direction,
				PageLimit: int32(remaining + 1),
			}
			if cursor != nil && cursor.Answered && cursor.At != nil {
				params.BeforeAnsweredAt = dbvalue.Timestamp(*cursor.At)
				params.BeforeContactID, _ = dbvalue.ParseUUID(cursor.ContactID)
			}
			rows, err := s.Queries.ListHubAnsweredChatRequests(r.Context(), params)
			if err != nil {
				s.InternalError(r.Context(), w, "list answered chat requests", err)
				return
			}
			for index, row := range rows {
				if index == remaining {
					next = &requestCursor{Answered: true}
					if index > 0 {
						last := rows[index-1]
						at := last.AnsweredAt.Time.UTC()
						next.At, next.ContactID = &at, dbvalue.FormatUUID(last.ContactID)
					}
					break
				}
				item, err := chatRequest(s, row.ContactID, row.AgencyDisplayName,
					row.AgencyDomain, row.Request)
				if err != nil {
					s.InternalError(r.Context(), w, "read answered chat request", err)
					return
				}
				response.Items = append(response.Items, item)
			}
		}
		if next != nil {
			next.HubUser, next.Direction = hubUser, direction
			key, err := signRequests(s, *next)
			if err != nil {
				s.InternalError(r.Context(), w, "encode chat request cursor", err)
				return
			}
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// agencyRequest finds the pointer holding the agency's request with the id;
// anything else is not found to the Hub user. The agency decides whether it
// is still pending, so a repeated answer replays rather than fails once the
// pointer shows it answered.
func agencyRequest(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	hubDID pgtype.UUID, id contacts.ChatRequestID,
) (sqlc.GetHubAgencyPointerByRequestRow, bool) {
	requestID, err := dbvalue.ParseUUID(string(id))
	if err != nil {
		s.Problem(r.Context(), w, hubproblem.HubChatRequestNotFoundError)
		return sqlc.GetHubAgencyPointerByRequestRow{}, false
	}
	pointer, err := s.Queries.GetHubAgencyPointerByRequest(r.Context(),
		sqlc.GetHubAgencyPointerByRequestParams{HubUserDid: hubDID, RequestID: requestID})
	if errors.Is(err, pgx.ErrNoRows) {
		s.Problem(r.Context(), w, hubproblem.HubChatRequestNotFoundError)
		return sqlc.GetHubAgencyPointerByRequestRow{}, false
	}
	if err != nil {
		s.InternalError(r.Context(), w, "get agency pointer", err)
		return sqlc.GetHubAgencyPointerByRequestRow{}, false
	}
	var request federationspec.AgencyPointerRequest
	if err := json.Unmarshal(pointer.Request, &request); err != nil {
		s.InternalError(r.Context(), w, "decode pointer request", err)
		return sqlc.GetHubAgencyPointerByRequestRow{}, false
	}
	if request.Direction != contacts.ToHubUser {
		s.Problem(r.Context(), w, hubproblem.HubChatRequestNotFoundError)
		return sqlc.GetHubAgencyPointerByRequestRow{}, false
	}
	return pointer, true
}

// answerChatRequest sends the Hub user's answer to the agency, which is
// authoritative for the request (MKT-DAT-005), and records the confirmed
// answer on the pointer. It writes a response unless the agency answered
// with certainty.
//
//vetchium:multiple-commits sends the federation command to the agency authority, then updates the local pointer on success
func answerChatRequest(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	pointer sqlc.GetHubAgencyPointerByRequestRow, digested any,
	answer federationspec.HubChatRequestAnswerPayload,
) (federationspec.AgencyPointerRequest, bool) {
	key, ok := handlerauth.IdempotencyKey(s, w, r)
	if !ok {
		return federationspec.AgencyPointerRequest{}, false
	}
	identity, _ := middleware.HubIdentityFromContext(r.Context())
	digest, err := requestDigest(digested)
	if err != nil {
		s.InternalError(r.Context(), w, "digest request", err)
		return federationspec.AgencyPointerRequest{}, false
	}
	me, err := s.Queries.GetHubPublicProfile(r.Context(), identity.UserDID)
	if err != nil {
		s.InternalError(r.Context(), w, "read Hub profile", err)
		return federationspec.AgencyPointerRequest{}, false
	}
	answer.ContactID = contacts.ContactID(dbvalue.FormatUUID(pointer.ContactID))
	answer.HubUserDID = hub.HubUserDID(dbvalue.FormatUUID(identity.UserDID))
	answer.HubUserDisplayName = common.DisplayName(me.DisplayName)
	answer.HubUserHandle = hub.HubHandle(me.Handle)
	answer.WindowSeconds = int64(s.ConversationWindow / time.Second)

	outcome, err := s.Commands.Send(r.Context(), commands.Request{
		Kind: federationspec.HubChatRequestAnswerKind,
		Authority: commands.Principal{
			Type: directoryspec.PrincipalOrg, DID: pointer.AgencyOrgDid,
		},
		AggregateID: string(answer.RequestID),
		Owner: commands.Owner{
			Type: commands.OwnerHubUser, ID: dbvalue.FormatUUID(identity.UserDID),
		},
		IdempotencyKey: key,
		RequestDigest:  digest,
		Payload:        answer,
	})
	if errors.Is(err, commands.ErrIdempotencyConflict) {
		s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
		return federationspec.AgencyPointerRequest{}, false
	}
	if err != nil {
		s.InternalError(r.Context(), w, "send hub-chat-request-answer", err)
		return federationspec.AgencyPointerRequest{}, false
	}
	switch outcome.State {
	case commands.StateSucceeded:
		var answered federationspec.AgencyPointerRequest
		if err := json.Unmarshal(outcome.Response.Body, &answered); err != nil {
			s.InternalError(r.Context(), w, "decode answered request", err)
			return federationspec.AgencyPointerRequest{}, false
		}
		stored, err := json.Marshal(answered)
		if err != nil {
			s.InternalError(r.Context(), w, "encode answered request", err)
			return federationspec.AgencyPointerRequest{}, false
		}
		// A replay, or the agency's event arriving first, finds nothing to
		// change.
		if _, err := s.Queries.SetHubAgencyPointerAnsweredRequest(r.Context(),
			sqlc.SetHubAgencyPointerAnsweredRequestParams{
				Request:    stored,
				Accepted:   answered.State == contacts.ChatRequestAccepted,
				ContactID:  pointer.ContactID,
				HubUserDid: identity.UserDID,
				TenantID:   s.TenantID,
			}); err != nil {
			s.InternalError(r.Context(), w, "record answered request", err)
			return federationspec.AgencyPointerRequest{}, false
		}
		return answered, true
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
	return federationspec.AgencyPointerRequest{}, false
}

// AcceptChatRequest accepts an agency's request and returns the conversation
// it opens (MKT-REQ-005).
func AcceptChatRequest(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.HubAcceptChatRequestRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		pointer, ok := agencyRequest(s, w, r, identity.UserDID, request.RequestID)
		if !ok {
			return
		}
		answered, ok := answerChatRequest(s, w, r, pointer, request,
			federationspec.HubChatRequestAnswerPayload{
				RequestID: request.RequestID, Accept: true,
			})
		if !ok {
			return
		}

		// The pointer lacks the messages and the window instants until the
		// agency's pointer event arrives, so a live read supplies them.
		limit := int32(hubmessages.DefaultPage)
		outcome, err := s.Conversations.RelayRead(r.Context(), federationspec.MeshReadConversationRequest{
			ContactID:    contacts.ContactID(dbvalue.FormatUUID(pointer.ContactID)),
			HubUserDID:   hub.HubUserDID(dbvalue.FormatUUID(identity.UserDID)),
			AgencyOrgDID: orgs.OrgDID(dbvalue.FormatUUID(pointer.AgencyOrgDid)),
			Limit:        &limit,
		})
		if err != nil || outcome.Problem != nil || outcome.Result == nil {
			s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
			return
		}
		current, err := s.Queries.GetHubAgencyPointer(r.Context(), sqlc.GetHubAgencyPointerParams{
			ContactID: pointer.ContactID, HubUserDid: identity.UserDID,
		})
		if err != nil {
			s.InternalError(r.Context(), w, "get agency pointer", err)
			return
		}
		conversation, err := summary(s, detailedPointer(current))
		if err != nil {
			s.InternalError(r.Context(), w, "read pointer", err)
			return
		}
		read := outcome.Result
		latest := hubChatRequest(s, pointer.ContactID, pointer.AgencyDisplayName,
			pointer.AgencyDomain, answered)
		conversation.HasConversation = true
		conversation.LatestRequest = &latest
		conversation.ReadOnlyReason = read.ReadOnlyReason
		conversation.AgencyMayWriteUntil = read.AgencyMayWriteUntil
		conversation.HubMayWriteUntil = read.HubMayWriteUntil
		if answered.AnsweredAt != nil && answered.AnsweredAt.After(conversation.LastActivityAt) {
			conversation.LastActivityAt = *answered.AnsweredAt
		}
		suggested := hubmessages.HubOpeningSuggestion{
			ConsumerDomain: answered.ConsumerDomain,
			OpeningNumber:  answered.OpeningNumber,
			SentAt:         answered.SentAt,
		}
		if !slices.ContainsFunc(conversation.Suggestions, func(s hubmessages.HubOpeningSuggestion) bool {
			return s.ConsumerDomain == suggested.ConsumerDomain && s.OpeningNumber == suggested.OpeningNumber
		}) {
			conversation.Suggestions = append(conversation.Suggestions, suggested)
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, hubmessages.HubConversationDetail{
			Conversation:       conversation,
			Messages:           read.Messages,
			PendingRequestNote: read.PendingRequestNote,
			NextPaginationKey:  read.NextPaginationKey,
		})
	}
}

// DeclineChatRequest declines an agency's request for its Opening or, with
// the sender scope, for one window (MKT-REQ-007).
func DeclineChatRequest(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.HubDeclineChatRequestRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		pointer, ok := agencyRequest(s, w, r, identity.UserDID, request.RequestID)
		if !ok {
			return
		}
		scope := request.Scope
		answered, ok := answerChatRequest(s, w, r, pointer, request,
			federationspec.HubChatRequestAnswerPayload{
				RequestID: request.RequestID, Scope: &scope,
			})
		if !ok {
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, hubChatRequest(s, pointer.ContactID,
			pointer.AgencyDisplayName, pointer.AgencyDomain, answered))
	}
}

// refusal answers from the pointer what the agency would refuse
// (MKT-REQ-003), so a plain refusal neither counts nor crosses the mesh.
// The agency decides the rest, an older `opening` decline included.
func (c agencyChat) refusal(opening contacts.OpeningSuggestion, now time.Time) *problem.Details {
	if c.pointer == nil {
		return nil
	}
	switch c.pointer.ReadOnlyReason.String {
	case "agency_deleted", "hub_user_deleted":
		return &hubproblem.HubConversationPartyDeletedError
	}
	switch c.state(opening, now) {
	case hubmessages.OpeningAgencyRequestSent, hubmessages.OpeningAgencyRequestReceived:
		return &hubproblem.HubChatRequestExistsError
	case hubmessages.OpeningAgencyOpen:
		return &hubproblem.HubConversationOpenError
	case hubmessages.OpeningAgencyDeclined:
		return &hubproblem.HubChatRequestBlockedError
	}
	return nil
}

// SendChatRequest asks an agency assigned to a published Opening to open a
// conversation (MKT-REQ-002, MKT-DAT-014). The send counts toward the Hub
// user's day before it leaves, so a request the agency refuses still counts
// (MKT-REQ-006); a repeat of a sent request replays it uncounted and
// unjudged.
//
//vetchium:multiple-commits counts the send before contacting the agency tenant, then records the confirmed request on the pointer
func SendChatRequest(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.HubSendChatRequestRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		agencies, ok := openingAgencies(s, w, r, openingsspec.MeshListOpeningAgenciesRequest{
			Domain: request.Domain, OpeningNumber: openingsspec.OpeningNumber(request.OpeningNumber),
		})
		if !ok {
			return
		}
		index := slices.IndexFunc(agencies, func(agency openingsspec.MeshOpeningAgency) bool {
			return agency.AgencyDomain == request.AgencyDomain
		})
		if index < 0 {
			s.Problem(r.Context(), w, hubproblem.HubAgencyNotAssignedError)
			return
		}
		agency := agencies[index]
		agencyDID, err := dbvalue.ParseUUID(string(agency.AgencyOrgDID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse agency DID", err)
			return
		}
		opening := contacts.OpeningSuggestion{
			ConsumerDomain: request.Domain, OpeningNumber: request.OpeningNumber,
		}
		now := s.CurrentTime()

		known, err := s.Commands.Known(r.Context(), federationspec.HubChatRequestKind,
			string(agency.AgencyOrgDID), key)
		if err != nil {
			s.InternalError(r.Context(), w, "find chat request operation", err)
			return
		}
		if !known {
			pointers, err := pointersByAgency(s, r, identity.UserDID, agencies[index:index+1])
			if err != nil {
				s.InternalError(r.Context(), w, "read agency pointer", err)
				return
			}
			var chat agencyChat
			if pointer, found := pointers[string(agency.AgencyOrgDID)]; found {
				if chat, err = newAgencyChat(&pointer); err != nil {
					s.InternalError(r.Context(), w, "read agency pointer", err)
					return
				}
			}
			if refusal := chat.refusal(opening, now); refusal != nil {
				s.Problem(r.Context(), w, *refusal)
				return
			}
			year, month, day := now.UTC().Date()
			counted, err := s.Queries.IncrementHubChatRequestCreations(r.Context(),
				sqlc.IncrementHubChatRequestCreationsParams{
					HubUserDid: identity.UserDID,
					Day: pgtype.Date{
						Time: time.Date(year, month, day, 0, 0, 0, 0, time.UTC), Valid: true,
					},
					MaxPerDay: hubmessages.MaxChatRequestsPerDay,
					TenantID:  s.TenantID,
				})
			if err != nil {
				s.InternalError(r.Context(), w, "count chat request", err)
				return
			}
			if counted.CountedRows != 1 {
				s.Problem(r.Context(), w, hubproblem.HubChatRequestLimitReachedError)
				return
			}
		}

		me, err := s.Queries.GetHubPublicProfile(r.Context(), identity.UserDID)
		if err != nil {
			s.InternalError(r.Context(), w, "read Hub profile", err)
			return
		}
		requestID, err := dbvalue.NewUUIDv7(now)
		if err != nil {
			s.InternalError(r.Context(), w, "mint request id", err)
			return
		}
		digest, err := requestDigest(request)
		if err != nil {
			s.InternalError(r.Context(), w, "digest request", err)
			return
		}
		outcome, err := s.Commands.Send(r.Context(), commands.Request{
			Kind: federationspec.HubChatRequestKind,
			Authority: commands.Principal{
				Type: directoryspec.PrincipalOrg, DID: agencyDID,
			},
			AggregateID: string(agency.AgencyOrgDID),
			Owner: commands.Owner{
				Type: commands.OwnerHubUser, ID: dbvalue.FormatUUID(identity.UserDID),
			},
			IdempotencyKey: key,
			RequestDigest:  digest,
			Payload: federationspec.HubChatRequestPayload{
				RequestID:          contacts.ChatRequestID(dbvalue.FormatUUID(requestID)),
				AgencyOrgDID:       agency.AgencyOrgDID,
				HubUserDID:         hub.HubUserDID(dbvalue.FormatUUID(identity.UserDID)),
				HubUserDisplayName: common.DisplayName(me.DisplayName),
				HubUserHandle:      hub.HubHandle(me.Handle),
				ConsumerDomain:     request.Domain,
				OpeningNumber:      request.OpeningNumber,
				Note:               request.Note,
				WindowSeconds:      int64(s.ConversationWindow / time.Second),
			},
		})
		if errors.Is(err, commands.ErrIdempotencyConflict) {
			s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "send hub-chat-request", err)
			return
		}
		switch outcome.State {
		case commands.StateSucceeded:
			var result federationspec.HubChatRequestResult
			if err := json.Unmarshal(outcome.Response.Body, &result); err != nil ||
				len(result.Validate()) != 0 {
				s.InternalError(r.Context(), w, "decode sent request",
					fmt.Errorf("invalid hub-chat-request result: %v", err))
				return
			}
			contactID, err := dbvalue.ParseUUID(string(result.ContactID))
			if err != nil {
				s.InternalError(r.Context(), w, "parse Contact id", err)
				return
			}
			stored, err := json.Marshal(result.Request)
			if err != nil {
				s.InternalError(r.Context(), w, "encode sent request", err)
				return
			}
			if _, err := s.Queries.RecordHubSentChatRequest(r.Context(),
				sqlc.RecordHubSentChatRequestParams{
					ContactID: contactID, HubUserDid: identity.UserDID,
					AgencyOrgDid:      agencyDID,
					AgencyDisplayName: agency.AgencyDisplayName,
					AgencyDomain:      string(agency.AgencyDomain),
					Request:           stored, TenantID: s.TenantID,
				}); err != nil {
				s.InternalError(r.Context(), w, "record sent request", err)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusOK, hubChatRequest(s, contactID,
				agency.AgencyDisplayName, string(agency.AgencyDomain), result.Request))
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
