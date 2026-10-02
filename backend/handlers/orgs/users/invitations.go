package users

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/authorization"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	"github.com/vetchium/src/typespec/orgs/users"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
	"backend/internal/orgs/orgmail"
	orgusers "backend/internal/orgs/users"
)

const invitationsPaginationPurpose = "orgs-list-invitations-v1"

// seatLimit is the cap the statement checks under the Org row lock: the lower
// of the current and any scheduled plan's (D13). Google sign-in enters here
// when its milestone adds the column.
func seatLimit(plan string, scheduled pgtype.Text) (pgtype.Int4, int32) {
	var scheduledPlan *subscriptionspec.Plan
	if scheduled.Valid {
		value := subscriptionspec.Plan(scheduled.String)
		scheduledPlan = &value
	}
	limit, unlimited := orgusers.SeatLimit(
		subscriptionspec.PlanOID(plan), scheduledPlan, false,
	)
	if unlimited {
		return pgtype.Int4{}, 0
	}
	return pgtype.Int4{Int32: int32(limit), Valid: true}, int32(limit)
}

func userLimitReached(limit int32) *handlerauth.Problem {
	return &handlerauth.Problem{Details: orgsproblem.UserLimitReachedError(limit)}
}

func invitationPayload(
	s *orgsruntime.Server, domain, token string, expiresAt time.Time,
) ([]byte, error) {
	return orgmail.Encrypt(s.CredentialSubkey("outbox"), orgmail.Payload{
		Domain: domain,
		ActionURL: handlerauth.EmailLink(
			s.PublicBaseURL, "/accept-invitation", s.TenantID, token,
		),
		ExpiresAt: expiresAt,
	})
}

func InviteUsers(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.InviteUsersRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		granted := authorization.DirectPermissions(request.Permissions)
		if !orgusers.CanGrant(identity.Permissions, granted) {
			s.Problem(r.Context(), w, orgsproblem.PermissionRequiredError)
			return
		}
		permissions := make([]string, len(granted))
		for index, permission := range granted {
			permissions[index] = string(permission)
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		now := s.CurrentTime()
		expiresAt := now.Add(s.InvitationTTL)
		type result = handlerauth.Result[users.InviteUsersResponse]
		handlerauth.RunIdempotent(
			s, w, r, "orgs:invite-users",
			dbvalue.FormatUUID(identity.UserID), key, request,
			now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				policy, err := q.LockOrgSeatPolicy(r.Context(), identity.OrgDID)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[users.InviteUsersResponse](
						orgsproblem.OrgSuspendedError,
					)
				}
				if err != nil {
					return result{}, nil, err
				}
				limit, limitValue := seatLimit(policy.OrgPlanOid, policy.ScheduledOrgPlanOid)

				params := sqlc.InviteOrgUsersParams{
					OrgDid:         identity.OrgDID,
					InvitedBy:      identity.UserID,
					SeatLimit:      limit,
					Permissions:    permissions,
					ExpiresAt:      dbvalue.Timestamp(expiresAt),
					TenantID:       s.TenantID,
					IdempotencyKey: dbvalue.Text(string(key)),
				}
				valid := make(map[string]bool, len(request.EmailAddresses))
				for _, address := range request.EmailAddresses {
					email := string(address)
					if !common.IsEmailAddress(common.EmailAddress(email)) {
						continue
					}
					token, tokenHash, err := credentials.NewToken()
					if err != nil {
						return result{}, nil, err
					}
					invitationID, err := dbvalue.NewUUID()
					if err != nil {
						return result{}, nil, err
					}
					payload, err := invitationPayload(
						s, policy.Domain, token, expiresAt,
					)
					if err != nil {
						return result{}, nil, err
					}
					valid[email] = true
					params.EmailAddresses = append(params.EmailAddresses, email)
					params.InvitationIds = append(params.InvitationIds, invitationID)
					params.TokenHashes = append(params.TokenHashes, tokenHash)
					params.PayloadCiphertexts = append(params.PayloadCiphertexts, payload)
				}

				outcomes := make(map[string]sqlc.InviteOrgUsersRow, len(valid))
				if len(params.EmailAddresses) > 0 {
					rows, err := q.InviteOrgUsers(r.Context(), params)
					if err != nil {
						return result{}, nil, err
					}
					for _, row := range rows {
						if row.Outcome == "limit-reached" {
							return result{}, userLimitReached(limitValue), nil
						}
						outcomes[row.EmailAddress] = row
					}
				}
				response := users.InviteUsersResponse{
					Results: make([]users.InviteResult, 0, len(request.EmailAddresses)),
				}
				for _, address := range request.EmailAddresses {
					email := string(address)
					entry := users.InviteResult{
						EmailAddress: email, Outcome: users.InvalidInvitee,
					}
					if row, ok := outcomes[email]; ok {
						entry.Outcome = users.InviteOutcome(row.Outcome)
						if row.ExpiresAt.Valid {
							expires := row.ExpiresAt.Time.UTC()
							entry.ExpiresAt = &expires
						}
					}
					response.Results = append(response.Results, entry)
				}
				return result{Status: http.StatusOK, Body: response}, nil, nil
			},
		)
	}
}

type invitationsPaginationPayload struct {
	AfterEmailAddress string `json:"after_email_address"`
	FiltersHash       string `json:"filters_hash"`
}

func invitationFiltersHash(search string) string {
	sum := sha256.Sum256([]byte(search))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func ListInvitations(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.ListInvitationsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		search := ""
		params := sqlc.ListOrgInvitationsParams{
			OrgDid:    identity.OrgDID,
			PageLimit: int32(request.EffectiveLimit()) + 1,
		}
		if request.FilterSearch != nil {
			search = strings.ToLower(strings.TrimSpace(string(*request.FilterSearch)))
			params.Search = dbvalue.Text(search)
		}
		filtersHash := invitationFiltersHash(search)
		if request.PaginationKey != nil {
			payload, ok := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), invitationsPaginationPurpose,
				string(*request.PaginationKey),
			)
			var decoded invitationsPaginationPayload
			if !ok || json.Unmarshal(payload, &decoded) != nil ||
				decoded.FiltersHash != filtersHash ||
				decoded.AfterEmailAddress == "" {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterEmailAddress = dbvalue.Text(decoded.AfterEmailAddress)
		}
		rows, err := s.Queries.ListOrgInvitations(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list Org invitations", err)
			return
		}
		limit := int(request.EffectiveLimit())
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := users.ListInvitationsResponse{
			Invitations: make([]users.InvitationSummary, 0, len(rows)),
		}
		for _, row := range rows {
			granted := make([]authorization.OrgPermissionID, len(row.Permissions))
			for index, permission := range row.Permissions {
				granted[index] = authorization.OrgPermissionID(permission)
			}
			response.Invitations = append(response.Invitations, users.InvitationSummary{
				EmailAddress: common.EmailAddress(row.EmailAddress),
				Permissions:  granted,
				InvitedBy:    common.EmailAddress(row.InvitedByEmailAddress),
				CreatedAt:    row.CreatedAt.Time.UTC(),
				ExpiresAt:    row.ExpiresAt.Time.UTC(),
			})
		}
		if hasMore {
			payload, err := json.Marshal(invitationsPaginationPayload{
				AfterEmailAddress: rows[len(rows)-1].EmailAddress,
				FiltersHash:       filtersHash,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode pagination key", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), invitationsPaginationPurpose,
				payload,
			))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func ResendInvitation(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.ResendInvitationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		expiresAt := now.Add(s.InvitationTTL)
		type result = handlerauth.Result[users.ResendInvitationResponse]
		handlerauth.RunIdempotent(
			s, w, r, "orgs:resend-invitation",
			dbvalue.FormatUUID(identity.UserID), key, request,
			now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				policy, err := q.LockOrgSeatPolicy(r.Context(), identity.OrgDID)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[users.ResendInvitationResponse](
						orgsproblem.OrgSuspendedError,
					)
				}
				if err != nil {
					return result{}, nil, err
				}
				limit, limitValue := seatLimit(policy.OrgPlanOid, policy.ScheduledOrgPlanOid)
				token, tokenHash, err := credentials.NewToken()
				if err != nil {
					return result{}, nil, err
				}
				payload, err := invitationPayload(s, policy.Domain, token, expiresAt)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.ResendOrgInvitation(
					r.Context(), sqlc.ResendOrgInvitationParams{
						OrgDid:            identity.OrgDID,
						EmailAddress:      string(request.EmailAddress),
						SeatLimit:         limit,
						TokenHash:         tokenHash,
						ExpiresAt:         dbvalue.Timestamp(expiresAt),
						PayloadCiphertext: payload,
						ActorOrgUserID:    identity.UserID,
						TenantID:          s.TenantID,
						IdempotencyKey:    dbvalue.Text(string(key)),
					},
				)
				if err != nil {
					return result{}, nil, err
				}
				switch row.Result {
				case "not-found":
					return handlerauth.Failure[users.ResendInvitationResponse](
						orgsproblem.InvitationNotFoundError,
					)
				case "limit-reached":
					return result{}, userLimitReached(limitValue), nil
				}
				return result{
					Status: http.StatusOK,
					Body: users.ResendInvitationResponse{
						ExpiresAt: row.ExpiresAt.Time.UTC(),
					},
				}, nil, nil
			},
		)
	}
}

func CancelInvitations(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.CancelInvitationsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		addresses := make([]string, len(request.EmailAddresses))
		for index, address := range request.EmailAddresses {
			addresses[index] = string(address)
		}
		allFound, err := s.Queries.CancelOrgInvitations(
			r.Context(), sqlc.CancelOrgInvitationsParams{
				OrgDid:         identity.OrgDID,
				EmailAddresses: addresses,
				TenantID:       s.TenantID,
				ActorOrgUserID: dbvalue.FormatUUID(identity.UserID),
				IdempotencyKey: pgtype.Text{},
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "cancel Org invitations", err)
			return
		}
		if !allFound {
			s.Problem(r.Context(), w, orgsproblem.InvitationNotFoundError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}

func GetInvitationDetails(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.GetInvitationDetailsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		row, err := s.Queries.GetOrgInvitationDetails(
			r.Context(), credentials.TokenHash(string(request.InvitationToken)),
		)
		if errors.Is(err, pgx.ErrNoRows) {
			s.AuthenticationProblem(
				r.Context(), w, orgsproblem.InvitationInvalidError,
				orgsauthn.InvitationChallenge,
			)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get Org invitation details", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, users.InvitationDetailsResponse{
			Domain:       orgs.OrgDomain(row.Domain),
			EmailAddress: common.EmailAddress(row.EmailAddress),
			ExpiresAt:    row.ExpiresAt.Time.UTC(),
		})
	}
}

func AcceptInvitation(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.AcceptInvitationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		tokenHash := credentials.TokenHash(string(request.InvitationToken))
		type result = handlerauth.Result[users.AcceptInvitationResponse]
		handlerauth.RunIdempotent(
			s, w, r, "orgs:accept-invitation",
			base64.RawURLEncoding.EncodeToString(tokenHash), key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				invalid := func() (result, *handlerauth.Problem, error) {
					return handlerauth.AuthenticationFailure[users.AcceptInvitationResponse](
						orgsproblem.InvitationInvalidError,
						orgsauthn.InvitationChallenge,
					)
				}
				org, err := q.LockOrgForInvitation(r.Context(), tokenHash)
				if errors.Is(err, pgx.ErrNoRows) {
					return invalid()
				}
				if err != nil {
					return result{}, nil, err
				}
				limit, limitValue := seatLimit(org.OrgPlanOid, org.ScheduledOrgPlanOid)
				passwordHash, err := credentials.HashPassword(string(request.Password))
				if err != nil {
					return result{}, nil, err
				}
				userID, err := dbvalue.NewUUID()
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.AcceptOrgInvitation(
					r.Context(), sqlc.AcceptOrgInvitationParams{
						OrgDid:            org.OrgDid,
						TokenHash:         tokenHash,
						SeatLimit:         limit,
						NewOrgUserID:      userID,
						PreferredLanguage: string(request.PreferredLanguage),
						PasswordHash:      passwordHash,
						TenantID:          s.TenantID,
						IdempotencyKey:    dbvalue.Text(string(key)),
					},
				)
				if err != nil {
					return result{}, nil, err
				}
				switch row.Result {
				case "invalid-token":
					return invalid()
				case "user-exists":
					return handlerauth.Failure[users.AcceptInvitationResponse](
						orgsproblem.UserAlreadyExistsError,
					)
				case "limit-reached":
					return result{}, userLimitReached(limitValue), nil
				}
				return result{
					Status: http.StatusCreated,
					Body: users.AcceptInvitationResponse{
						Domain:       orgs.OrgDomain(row.Domain),
						EmailAddress: common.EmailAddress(row.EmailAddress),
					},
				}, nil, nil
			},
		)
	}
}
