package auth

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	orgsauth "github.com/vetchium/src/typespec/orgs/auth"
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
)

const passwordResetTTL = 30 * time.Minute

func RequestPasswordReset(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.RequestPasswordResetRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		now := s.CurrentTime()
		binding := string(request.Domain) + "/" + string(request.EmailAddress)
		handlerauth.RunIdempotent(
			s, w, r, "orgs:request-password-reset", binding, key, request,
			now.Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				token, tokenHash, err := credentials.NewToken()
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				expiresAt := now.Add(passwordResetTTL)
				payload, err := orgmail.Encrypt(
					s.CredentialSubkey("outbox"), orgmail.Payload{
						Domain: string(request.Domain),
						ActionURL: s.PublicBaseURL + "/reset-password?token=" +
							url.QueryEscape(token),
						ExpiresAt: expiresAt,
					},
				)
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				if _, err := q.CreateOrgPasswordReset(
					r.Context(), sqlc.CreateOrgPasswordResetParams{
						Domain:            string(request.Domain),
						EmailAddress:      string(request.EmailAddress),
						TokenHash:         tokenHash,
						ExpiresAt:         dbvalue.Timestamp(expiresAt),
						PayloadCiphertext: payload,
						TenantID:          s.TenantID,
						IdempotencyKey:    dbvalue.Text(string(key)),
					},
				); err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				return handlerauth.Result[struct{}]{
					Status: http.StatusAccepted, Body: struct{}{},
				}, nil, nil
			},
		)
	}
}

func CompletePasswordReset(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.CompletePasswordResetRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		resetHash := credentials.TokenHash(string(request.ResetToken))
		binding := base64.RawURLEncoding.EncodeToString(resetHash)
		handlerauth.RunIdempotent(
			s, w, r, "orgs:complete-password-reset", binding, key,
			request, s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				return handlerauth.PasswordReset{
					ResetTokenHash: resetHash,
					NewPassword:    string(request.NewPassword),
					IdempotencyKey: key,
					TenantID:       s.TenantID,
					InvalidToken:   orgsproblem.InvalidPasswordResetTokenError,
					Challenge:      orgsauthn.PasswordResetChallenge,
					ResolveUser:    resolveOrgPasswordResetUser,
					LockUser:       lockOrgUser,
					Complete:       completeOrgPasswordReset,
				}.Run(r.Context(), q)
			},
		)
	}
}

func resolveOrgPasswordResetUser(
	ctx context.Context, q *sqlc.Queries, tokenHash []byte,
) (pgtype.UUID, error) {
	return q.ResolveOrgPasswordResetUser(ctx, tokenHash)
}

func completeOrgPasswordReset(
	ctx context.Context, q *sqlc.Queries,
	reset handlerauth.CompletedPasswordReset,
) (bool, error) {
	return q.CompleteOrgPasswordReset(
		ctx, sqlc.CompleteOrgPasswordResetParams{
			ResetTokenHash: reset.ResetTokenHash,
			PasswordHash:   reset.PasswordHash,
			TenantID:       reset.TenantID,
			IdempotencyKey: reset.IdempotencyKey,
		},
	)
}

func ChangePassword(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.ChangePasswordRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		handlerauth.ChangePassword(
			s, w, r, "change Org password", string(request.NewPassword),
			func(ctx context.Context, hash string) (bool, error) {
				return s.Queries.ChangeOrgPassword(
					ctx, sqlc.ChangeOrgPasswordParams{
						PasswordHash:        hash,
						OrgUserID:           identity.UserID,
						CurrentOrgSessionID: identity.SessionID,
						TenantID:            s.TenantID,
					},
				)
			},
			orgsproblem.AuthenticationRequiredError,
			orgsauthn.BearerChallenge,
		)
	}
}
