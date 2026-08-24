package hub

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"

	hubauth "github.com/vetchium/src/typespec/hub/auth"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	"backend/internal/hubapi"
	"backend/internal/middleware"
)

const passwordResetTTL = 30 * time.Minute

type passwordResetEmailPayload struct {
	ResetURL  string    `json:"reset_url"`
	ExpiresAt time.Time `json:"expires_at"`
}

func RequestPasswordReset(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.RequestPasswordResetRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		request = request.Normalize()
		emailAddress := string(request.EmailAddress)
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		now := s.CurrentTime()
		runIdempotent(
			s, w, r, "hub:request-password-reset", emailAddress, key,
			request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (
				idempotentResult[struct{}], *apiProblem, error,
			) {
				token, tokenHash, err := hubapi.NewToken()
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				expiresAt := now.Add(passwordResetTTL)
				payload, err := json.Marshal(passwordResetEmailPayload{
					ResetURL: s.PublicBaseURL + "/reset-password?token=" +
						url.QueryEscape(token),
					ExpiresAt: expiresAt,
				})
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				ciphertext, err := hubapi.Encrypt(
					s.CredentialSubkey("outbox"), payload,
				)
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				_, err = q.CreateHubPasswordReset(
					r.Context(), sqlc.CreateHubPasswordResetParams{
						EmailAddress: emailAddress, TokenHash: tokenHash,
						ExpiresAt:         hubapi.Timestamp(expiresAt),
						PayloadCiphertext: ciphertext, TenantID: s.TenantID,
						IdempotencyKey: hubapi.Text(string(key)),
					},
				)
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				return idempotentResult[struct{}]{
					status: http.StatusAccepted, body: struct{}{},
				}, nil, nil
			},
		)
	}
}

func CompletePasswordReset(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.CompletePasswordResetRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		resetHash := hubapi.TokenHash(string(request.ResetToken))
		binding := base64.RawURLEncoding.EncodeToString(resetHash)
		runIdempotent(
			s, w, r, "hub:complete-password-reset", binding, key,
			request, s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				idempotentResult[struct{}], *apiProblem, error,
			) {
				userDID, err := q.ResolveHubPasswordResetUser(
					r.Context(), resetHash,
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return invalidPasswordResetResult()
				}
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				if _, err := q.LockHubUserCredentialMutation(
					r.Context(), userDID,
				); err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				hash, err := hubapi.HashPassword(string(request.NewPassword))
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				completed, err := q.CompleteHubPasswordReset(
					r.Context(), sqlc.CompleteHubPasswordResetParams{
						ResetTokenHash: resetHash,
						PasswordHash:   hash,
						TenantID:       s.TenantID,
						IdempotencyKey: hubapi.Text(string(key)),
					},
				)
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				if !completed {
					return invalidPasswordResetResult()
				}
				return idempotentResult[struct{}]{
					status: http.StatusNoContent, body: struct{}{},
				}, nil, nil
			},
		)
	}
}

func ChangePassword(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.ChangePasswordRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		hash, err := hubapi.HashPassword(string(request.NewPassword))
		if err != nil {
			s.InternalError(r.Context(), w, "hash changed Hub password", err)
			return
		}
		changed, err := s.Queries.ChangeHubPassword(
			r.Context(), sqlc.ChangeHubPasswordParams{
				PasswordHash:        hash,
				HubUserDid:          identity.UserDID,
				CurrentHubSessionID: identity.SessionID,
				TenantID:            s.TenantID,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "change Hub password", err)
			return
		}
		if !changed {
			s.Problem(
				r.Context(), w, hubproblem.AuthenticationRequiredError,
				hubapi.BearerChallenge,
			)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func invalidPasswordResetResult() (
	idempotentResult[struct{}], *apiProblem, error,
) {
	return idempotentResult[struct{}]{}, &apiProblem{
		details:         hubproblem.InvalidPasswordResetTokenError,
		wwwAuthenticate: hubapi.PasswordResetChallenge,
	}, nil
}
