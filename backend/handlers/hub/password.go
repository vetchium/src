package hub

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	hubauth "github.com/vetchium/src/typespec/hub/auth"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
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
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		request = request.Normalize()
		emailAddress := string(request.EmailAddress)
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "hub:request-password-reset", emailAddress, key,
			request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				token, tokenHash, err := credentials.NewToken()
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				expiresAt := now.Add(passwordResetTTL)
				payload, err := json.Marshal(passwordResetEmailPayload{
					ResetURL: s.PublicBaseURL + "/reset-password?token=" +
						url.QueryEscape(token),
					ExpiresAt: expiresAt,
				})
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				ciphertext, err := credentials.Encrypt(
					s.CredentialSubkey("outbox"), payload,
				)
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				_, err = q.CreateHubPasswordReset(
					r.Context(), sqlc.CreateHubPasswordResetParams{
						EmailAddress: emailAddress, TokenHash: tokenHash,
						ExpiresAt:         dbvalue.Timestamp(expiresAt),
						PayloadCiphertext: ciphertext, TenantID: s.TenantID,
						IdempotencyKey: dbvalue.Text(string(key)),
					},
				)
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				return handlerauth.Result[struct{}]{
					Status: http.StatusAccepted, Body: struct{}{},
				}, nil, nil
			},
		)
	}
}

func CompletePasswordReset(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.CompletePasswordResetRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		resetHash := credentials.TokenHash(string(request.ResetToken))
		binding := base64.RawURLEncoding.EncodeToString(resetHash)
		handlerauth.RunIdempotent(
			s, w, r, "hub:complete-password-reset", binding, key,
			request, s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				return handlerauth.PasswordReset{
					ResetTokenHash: resetHash,
					NewPassword:    string(request.NewPassword),
					IdempotencyKey: key,
					TenantID:       s.TenantID,
					InvalidToken:   hubproblem.InvalidPasswordResetTokenError,
					Challenge:      hubapi.PasswordResetChallenge,
					ResolveUser:    resolveHubPasswordResetUser,
					LockUser:       lockHubUser,
					Complete:       completeHubPasswordReset,
				}.Run(r.Context(), q)
			},
		)
	}
}

func resolveHubPasswordResetUser(
	ctx context.Context, q *sqlc.Queries, tokenHash []byte,
) (pgtype.UUID, error) {
	return q.ResolveHubPasswordResetUser(ctx, tokenHash)
}

func lockHubUser(
	ctx context.Context, q *sqlc.Queries, userDID pgtype.UUID,
) error {
	_, err := q.LockHubUserCredentialMutation(ctx, userDID)
	return err
}

func completeHubPasswordReset(
	ctx context.Context, q *sqlc.Queries,
	reset handlerauth.CompletedPasswordReset,
) (bool, error) {
	return q.CompleteHubPasswordReset(
		ctx, sqlc.CompleteHubPasswordResetParams{
			ResetTokenHash: reset.ResetTokenHash,
			PasswordHash:   reset.PasswordHash,
			TenantID:       reset.TenantID,
			IdempotencyKey: reset.IdempotencyKey,
		},
	)
}

func ChangePassword(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.ChangePasswordRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		handlerauth.ChangePassword(
			s, w, r, "change Hub password",
			string(request.NewPassword),
			func(ctx context.Context, hash string) (bool, error) {
				return s.Queries.ChangeHubPassword(
					ctx, sqlc.ChangeHubPasswordParams{
						PasswordHash:        hash,
						HubUserDid:          identity.UserDID,
						CurrentHubSessionID: identity.SessionID,
						TenantID:            s.TenantID,
					},
				)
			},
			hubproblem.AuthenticationRequiredError,
			hubapi.BearerChallenge,
		)
	}
}
