package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	adminauth "github.com/vetchium/src/typespec/admin/auth"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	adminruntime "backend/internal/admin"
	adminauthn "backend/internal/admin/auth"
	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
)

const passwordResetTTL = 30 * time.Minute

func RequestPasswordReset(s *adminruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.RequestPasswordResetRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		token, tokenHash, err := credentials.NewToken()
		if err != nil {
			s.InternalError(r.Context(), w, "generate password reset token", err)
			return
		}
		payload, err := json.Marshal(struct {
			ResetToken string `json:"reset_token"`
			TenantID   string `json:"tenant_id"`
		}{ResetToken: token, TenantID: s.TenantID})
		if err != nil {
			s.InternalError(r.Context(), w, "encode password reset email", err)
			return
		}
		ciphertext, err := credentials.Encrypt(
			s.CredentialSubkey("outbox"), payload,
		)
		if err != nil {
			s.InternalError(r.Context(), w, "encrypt password reset email", err)
			return
		}
		_, err = handlerauth.WithCredentialLock(
			s, r, adminCredentialLocker(adminCredentialLock{
				emailAddress: string(request.EmailAddress),
			}),
			func(q sqlc.Querier) (bool, error) {
				return q.CreateAdminPasswordReset(
					r.Context(), sqlc.CreateAdminPasswordResetParams{
						RequestEmailAddress: string(request.EmailAddress),
						TokenHash:           tokenHash,
						ExpiresAt: dbvalue.Timestamp(
							s.CurrentTime().Add(passwordResetTTL),
						),
						PayloadCiphertext: ciphertext,
						TenantID:          s.TenantID,
					},
				)
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "create password reset", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.Empty(r.Context(), w, http.StatusAccepted)
	}
}

func CompletePasswordReset(s *adminruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.CompletePasswordResetRequest
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
			s, w, r, "admin:complete-password-reset", binding, key,
			request, s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				return handlerauth.PasswordReset{
					ResetTokenHash: resetHash,
					NewPassword:    string(request.NewPassword),
					IdempotencyKey: key,
					TenantID:       s.TenantID,
					InvalidToken:   adminproblem.InvalidPasswordResetTokenError,
					Challenge:      adminauthn.PasswordResetChallenge,
					ResolveUser:    resolveAdminPasswordResetUser,
					LockUser:       lockAdminUser,
					Complete:       completeAdminPasswordReset,
				}.Run(r.Context(), q)
			},
		)
	}
}

func resolveAdminPasswordResetUser(
	ctx context.Context, q *sqlc.Queries, tokenHash []byte,
) (pgtype.UUID, error) {
	return q.ResolveAdminPasswordResetUser(ctx, tokenHash)
}

func lockAdminUser(
	ctx context.Context, q *sqlc.Queries, adminUserID pgtype.UUID,
) error {
	_, err := q.LockAdminUserCredentialMutation(ctx, adminUserID)
	return err
}

func completeAdminPasswordReset(
	ctx context.Context, q *sqlc.Queries,
	reset handlerauth.CompletedPasswordReset,
) (bool, error) {
	return q.CompleteAdminPasswordReset(
		ctx, sqlc.CompleteAdminPasswordResetParams{
			ResetTokenHash: reset.ResetTokenHash,
			PasswordHash:   reset.PasswordHash,
			TenantID:       reset.TenantID,
			IdempotencyKey: reset.IdempotencyKey,
		},
	)
}

func ChangePassword(s *adminruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.ChangePasswordRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		handlerauth.ChangePassword(
			s, w, r, "change admin password",
			string(request.NewPassword),
			func(ctx context.Context, hash string) (bool, error) {
				return s.Queries.ChangeAdminPassword(
					ctx, sqlc.ChangeAdminPasswordParams{
						PasswordHash:          hash,
						TargetAdminUserID:     identity.UserID,
						CurrentAdminSessionID: identity.SessionID,
						TenantID:              s.TenantID,
					},
				)
			},
			adminproblem.AdminAuthenticationRequiredError,
			adminauthn.BearerChallenge,
		)
	}
}
