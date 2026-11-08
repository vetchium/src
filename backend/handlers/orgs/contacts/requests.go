package contacts

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/agencycontacts"
	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

const requestsPurpose = "orgs-list-chat-requests-v1"

// chatRequest is a request as the agency sees it; the table keeps the note
// only while the request is pending (MKT-REQ-012).
func chatRequest(
	row sqlc.VetchiumOrgChatRequest, name, handle string,
) contacts.ChatRequest {
	request := contacts.ChatRequest{
		RequestNumber: contacts.ChatRequestNumber(row.RequestNumber),
		Direction:     contacts.ChatRequestDirection(row.Direction),
		State:         contacts.ChatRequestState(row.State),
		Opening: contacts.OpeningSuggestion{
			ConsumerDomain: orgs.OrgDomain(row.ConsumerDomain),
			OpeningNumber:  openings.OpeningNumber(row.OpeningNumber),
		},
		HubUserName:   common.DisplayName(name),
		HubUserHandle: hub.HubHandle(handle),
		SentAt:        row.SentAt.Time.UTC(),
		BlockedUntil:  agencycontacts.BlockedUntil(row),
		WindowDays:    agencycontacts.WindowDays(row.WindowSeconds),
	}
	if row.Note.Valid {
		note := contacts.ChatRequestNote(row.Note.String)
		request.Note = &note
	}
	if request.Direction == contacts.ToHubUser {
		// An agency user's email address stands in for their name
		// (MKT-GEN-005).
		sender := common.EmailAddress(row.SenderDisplayName)
		request.SentBy = &sender
	}
	if row.AnsweredAt.Valid {
		at := row.AnsweredAt.Time.UTC()
		request.AnsweredAt = &at
	}
	if row.DeclineScope.Valid {
		scope := contacts.ChatRequestDeclineScope(row.DeclineScope.String)
		request.DeclineScope = &scope
	}
	return request
}

// SendChatRequest asks a person to open the conversation about an Opening
// the agency is assigned to, creating the Contact when there is none
// (MKT-REQ-002, MKT-DAT-004). The person and the Opening are read before the
// transaction opens: no transaction waits on another tenant.
func SendChatRequest(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.SendChatRequestRequest
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
			s.Problem(r.Context(), w, orgsproblem.AgencyRequestsOffError)
			return
		}
		hubDID, err := dbvalue.ParseUUID(string(read.HubUserDID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse Hub user DID", err)
			return
		}
		name, handle := string(read.Profile.DisplayName), string(read.Profile.Handle)
		if !confirmSuggestion(s, w, r, identity, &request.Suggestion) {
			return
		}
		now := s.CurrentTime()
		type result = handlerauth.Result[contacts.ChatRequest]
		handlerauth.RunIdempotent(s, w, r, "orgs:send-chat-request",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(replayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				fail := handlerauth.Failure[contacts.ChatRequest]
				if _, err := q.LockOrgForContacts(ctx, identity.OrgDID); err != nil {
					return result{}, nil, fmt.Errorf("lock Org: %w", err)
				}
				// An agency without a listed sourcing Listing sends no
				// requests (MKT-CNV-003).
				listed, err := q.OrgHasListedSourcingListing(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, err
				}
				if !listed {
					return fail(orgsproblem.ListingNotAvailableError)
				}
				day := pgtype.Date{Time: today(now), Valid: true}
				existing, err := q.LockOrgContact(ctx, sqlc.LockOrgContactParams{
					OrgDid: identity.OrgDID, HubUserDid: hubDID,
				})
				switch {
				case isNoRows(err):
					created, err := q.CountOrgContactsCreatedOn(ctx, sqlc.CountOrgContactsCreatedOnParams{
						OrgDid: identity.OrgDID, Day: day,
					})
					if err != nil {
						return result{}, nil, err
					}
					if created >= contacts.MaxNewContactsPerDay {
						return fail(orgsproblem.ContactLimitReachedError)
					}
					row, err := q.CreateOrgContact(ctx, sqlc.CreateOrgContactParams{
						OrgDid: identity.OrgDID, HubUserDid: hubDID,
						DisplayName: name, Handle: handle, ActorID: identity.UserID,
						Day: day, TenantID: s.TenantID,
						IdempotencyKey: dbvalue.Text(string(key)),
					})
					if err != nil {
						return result{}, nil, err
					}
					if row.CreatedRows != 1 || row.CountedRows != 1 || row.AuditRows != 1 {
						return result{}, nil, fmt.Errorf("incomplete Contact creation")
					}
				case err != nil:
					return result{}, nil, fmt.Errorf("lock Contact: %w", err)
				default:
					// The live read is newer than the setting the Contact
					// keeps; the Hub user's tenant reports the change too.
					if existing.RequestsOff {
						return fail(orgsproblem.AgencyRequestsOffError)
					}
					if existing.DisplayName != name {
						if _, err := q.RefreshOrgContactNames(ctx, sqlc.RefreshOrgContactNamesParams{
							DisplayName: name, HubUserDid: hubDID,
							OrgDid: identity.OrgDID, TenantID: s.TenantID,
							ActorID: identity.UserID, IdempotencyKey: dbvalue.Text(string(key)),
						}); err != nil {
							return result{}, nil, err
						}
					}
				}
				refusal, err := agencycontacts.Refuse(ctx, q, identity.OrgDID,
					hubDID, contacts.ToHubUser, request.Suggestion, now)
				if err != nil {
					return result{}, nil, err
				}
				if refusal != agencycontacts.NotRefused {
					return fail(refusals[refusal])
				}
				sent, err := q.CountOrgChatRequestsCreatedOn(ctx, sqlc.CountOrgChatRequestsCreatedOnParams{
					OrgDid: identity.OrgDID, Day: day,
				})
				if err != nil {
					return result{}, nil, err
				}
				if sent >= contacts.MaxChatRequestsPerDay {
					return fail(orgsproblem.ChatRequestLimitReachedError)
				}
				sender, err := q.GetOrgMyInfo(ctx, identity.UserID)
				if err != nil {
					return result{}, nil, fmt.Errorf("read sender: %w", err)
				}
				var note pgtype.Text
				if request.Note != nil {
					note = dbvalue.Text(string(*request.Note))
				}
				created, err := q.CreateOrgChatRequest(ctx, sqlc.CreateOrgChatRequestParams{
					OrgDid: identity.OrgDID, HubUserDid: hubDID, Direction: string(contacts.ToHubUser),
					ConsumerDomain: string(request.Suggestion.ConsumerDomain),
					OpeningNumber:  int32(request.Suggestion.OpeningNumber),
					Note:           note, SenderUserID: identity.UserID,
					SenderDisplayName: sender.EmailAddress, Day: day,
					TenantID: s.TenantID, ActorType: "org_user",
					ActorID: dbvalue.FormatUUID(identity.UserID), Source: "orgs-api",
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if created.CountedRows != 1 || created.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete chat request")
				}
				if err := agencycontacts.SyncPointer(ctx, q, identity.OrgDID,
					hubDID, agencycontacts.NoticeRequest); err != nil {
					return result{}, nil, err
				}
				row, err := q.GetOrgChatRequest(ctx, sqlc.GetOrgChatRequestParams{
					OrgDid: identity.OrgDID, HubUserDid: hubDID,
					RequestNumber: created.RequestNumber,
				})
				if err != nil {
					return result{}, nil, fmt.Errorf("read chat request: %w", err)
				}
				return result{Status: http.StatusOK, Body: chatRequest(
					row.VetchiumOrgChatRequest, row.HubUserName, row.HubUserHandle,
				)}, nil, nil
			})
	}
}

// AcceptChatRequest accepts a Hub user's request to the agency and returns
// the conversation it opens or reopens (MKT-REQ-005, MKT-CNV-004).
func AcceptChatRequest(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.AcceptChatRequestRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		org := dbvalue.FormatUUID(identity.OrgDID)
		now := s.CurrentTime()
		type result = handlerauth.Result[contacts.ConversationDetail]
		handlerauth.RunIdempotent(s, w, r, "orgs:accept-chat-request",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(replayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				fail := handlerauth.Failure[contacts.ConversationDetail]
				answered, err := agencycontacts.AnswerAgencyRequest(ctx, q,
					identity.OrgDID, string(request.Handle), int32(request.RequestNumber),
					agencycontacts.Answer{Accept: true},
					orgAnswerer(s, identity, key))
				switch {
				case errors.Is(err, agencycontacts.ErrRequestNotFound):
					return fail(orgsproblem.ChatRequestNotFoundError)
				case errors.Is(err, agencycontacts.ErrConversationReadOnly):
					return fail(orgsproblem.ConversationPartyDeletedError)
				case err != nil:
					return result{}, nil, err
				}
				detail, err := readConversation(ctx, q, identity.OrgDID,
					answered.HubUserDid, nil, contacts.DefaultPage, now,
					func(at time.Time, number int32) (common.PaginationKey, error) {
						return sign(s, messagesPurpose, pageCursor{
							Org: org, Contact: string(request.Handle), At: at, Number: number,
						})
					})
				if err != nil {
					return result{}, nil, fmt.Errorf("read conversation: %w", err)
				}
				return result{Status: http.StatusOK, Body: detail}, nil, nil
			})
	}
}

// DeclineChatRequest declines a Hub user's request to the agency for its
// Opening or, with scope sender, for one window (MKT-REQ-007).
func DeclineChatRequest(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.DeclineChatRequestRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[contacts.ChatRequest]
		handlerauth.RunIdempotent(s, w, r, "orgs:decline-chat-request",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(replayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				answered, err := agencycontacts.AnswerAgencyRequest(ctx, q,
					identity.OrgDID, string(request.Handle), int32(request.RequestNumber),
					agencycontacts.Answer{Scope: request.Scope},
					orgAnswerer(s, identity, key))
				if errors.Is(err, agencycontacts.ErrRequestNotFound) {
					return handlerauth.Failure[contacts.ChatRequest](
						orgsproblem.ChatRequestNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.GetOrgChatRequest(ctx, sqlc.GetOrgChatRequestParams{
					OrgDid: identity.OrgDID, HubUserDid: answered.HubUserDid,
					RequestNumber: answered.RequestNumber,
				})
				if err != nil {
					return result{}, nil, fmt.Errorf("read chat request: %w", err)
				}
				return result{Status: http.StatusOK, Body: chatRequest(
					row.VetchiumOrgChatRequest, row.HubUserName, row.HubUserHandle,
				)}, nil, nil
			})
	}
}

// refusals names each MKT-REQ-003 refusal with the Orgs problem type.
var refusals = map[agencycontacts.Refusal]problem.Body{
	agencycontacts.RefusedPartyDeleted:     orgsproblem.ConversationPartyDeletedError,
	agencycontacts.RefusedRequestPending:   orgsproblem.ChatRequestExistsError,
	agencycontacts.RefusedConversationOpen: orgsproblem.ConversationOpenError,
	agencycontacts.RefusedBlocked:          orgsproblem.ChatRequestBlockedError,
}

// requestCursor is where the next page of requests resumes: within the
// pending ones, or within the answered ones that follow them (At nil starts
// those). It is bound to the Org and the direction. A pending request is
// the only one of its pair, so its handle positions it; an answered one also
// needs its number.
type requestCursor struct {
	Org       string     `json:"org"`
	Direction string     `json:"direction"`
	Answered  bool       `json:"answered"`
	At        *time.Time `json:"at,omitempty"`
	Handle    string     `json:"handle,omitempty"`
	Number    int32      `json:"number,omitempty"`
}

func signRequests(s *orgsruntime.Server, cursor requestCursor) (common.PaginationKey, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return common.PaginationKey(credentials.SignValue(
		s.CredentialSubkey("pagination"), requestsPurpose, payload)), nil
}

func verifyRequests(
	s *orgsruntime.Server, key common.PaginationKey, org, direction string,
) (requestCursor, bool) {
	payload, valid := credentials.VerifySignedValue(
		s.CredentialSubkey("pagination"), requestsPurpose, string(key))
	var cursor requestCursor
	if !valid || json.Unmarshal(payload, &cursor) != nil ||
		cursor.Org != org || cursor.Direction != direction ||
		(cursor.At == nil) != (cursor.Handle == "") ||
		(!cursor.Answered && cursor.At == nil) ||
		(cursor.Answered && cursor.At != nil) != (cursor.Number > 0) {
		return requestCursor{}, false
	}
	return cursor, true
}

// ListChatRequests lists the agency's requests in one direction: pending
// ones oldest first, then answered ones newest answer first.
func ListChatRequests(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.ListChatRequestsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		org, direction := dbvalue.FormatUUID(identity.OrgDID), string(request.Direction)
		var cursor *requestCursor
		if request.PaginationKey != nil {
			found, valid := verifyRequests(s, *request.PaginationKey, org, direction)
			if !valid {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			cursor = &found
		}
		limit := int(request.EffectiveLimit())
		response := contacts.ListChatRequestsResponse{Items: []contacts.ChatRequest{}}
		var next *requestCursor
		if cursor == nil || !cursor.Answered {
			params := sqlc.ListPendingOrgChatRequestsParams{
				OrgDid: identity.OrgDID, Direction: direction,
				PageLimit: int32(limit + 1),
			}
			if cursor != nil {
				params.AfterSentAt = dbvalue.Timestamp(*cursor.At)
				params.AfterHandle = dbvalue.Text(cursor.Handle)
			}
			rows, err := s.Queries.ListPendingOrgChatRequests(r.Context(), params)
			if err != nil {
				s.InternalError(r.Context(), w, "list pending chat requests", err)
				return
			}
			for index, row := range rows {
				if index == limit {
					last := rows[index-1]
					at := last.VetchiumOrgChatRequest.SentAt.Time.UTC()
					next = &requestCursor{At: &at, Handle: last.HubUserHandle}
					break
				}
				response.Items = append(response.Items, chatRequest(
					row.VetchiumOrgChatRequest, row.HubUserName, row.HubUserHandle))
			}
		}
		if next == nil {
			remaining := limit - len(response.Items)
			params := sqlc.ListAnsweredOrgChatRequestsParams{
				OrgDid: identity.OrgDID, Direction: direction,
				PageLimit: int32(remaining + 1),
			}
			if cursor != nil && cursor.Answered && cursor.At != nil {
				params.BeforeAnsweredAt = dbvalue.Timestamp(*cursor.At)
				params.BeforeHandle = dbvalue.Text(cursor.Handle)
				params.BeforeRequestNumber = pgtype.Int4{Int32: cursor.Number, Valid: true}
			}
			rows, err := s.Queries.ListAnsweredOrgChatRequests(r.Context(), params)
			if err != nil {
				s.InternalError(r.Context(), w, "list answered chat requests", err)
				return
			}
			for index, row := range rows {
				if index == remaining {
					next = &requestCursor{Answered: true}
					if index > 0 {
						last := rows[index-1]
						at := last.VetchiumOrgChatRequest.AnsweredAt.Time.UTC()
						next.At, next.Handle = &at, last.HubUserHandle
						next.Number = last.VetchiumOrgChatRequest.RequestNumber
					}
					break
				}
				response.Items = append(response.Items, chatRequest(
					row.VetchiumOrgChatRequest, row.HubUserName, row.HubUserHandle))
			}
		}
		if next != nil {
			next.Org, next.Direction = org, direction
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

// CountPendingChatRequests counts the Hub users' requests awaiting the
// agency's answer, for the Home card and the navigation (MKT-UI-011).
func CountPendingChatRequests(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		count, err := s.Queries.CountPendingOrgChatRequests(r.Context(), identity.OrgDID)
		if err != nil {
			s.InternalError(r.Context(), w, "count pending chat requests", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, contacts.PendingChatRequestCount{Count: count})
	}
}
