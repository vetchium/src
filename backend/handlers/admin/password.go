package admin

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	adminauth "github.com/vetchium/src/typespec/admin/auth"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

const passwordResetTTL = 30 * time.Minute

func RequestPasswordReset(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.RequestPasswordResetRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		request = request.Normalize()
		token, tokenHash, err := adminapi.NewToken()
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
		ciphertext, err := adminapi.Encrypt(
			s.CredentialSubkey("outbox"), payload,
		)
		if err != nil {
			s.InternalError(r.Context(), w, "encrypt password reset email", err)
			return
		}
		_, err = withAdminCredentialLock(
			s, r, adminCredentialLock{
				emailAddress: string(request.EmailAddress),
			},
			func(q sqlc.Querier) (bool, error) {
				return q.CreateAdminPasswordReset(
					r.Context(), sqlc.CreateAdminPasswordResetParams{
						RequestEmailAddress: string(request.EmailAddress),
						TokenHash:           tokenHash,
						ExpiresAt: adminapi.Timestamp(
							s.CurrentTime().Add(passwordResetTTL),
						),
						PayloadCiphertext: ciphertext,
					},
				)
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "create password reset", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusAccepted)
	}
}

func CompletePasswordReset(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.CompletePasswordResetRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		binding := base64.RawURLEncoding.EncodeToString(adminapi.TokenHash(
			string(request.ResetToken),
		))
		runIdempotent(
			s, w, r, "admin:complete-password-reset", binding, key,
			request, s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				idempotentResult[struct{}], *apiProblem, error,
			) {
				hash, err := adminapi.HashPassword(string(request.NewPassword))
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				resetTokenHash := adminapi.TokenHash(
					string(request.ResetToken),
				)
				adminUserID, err := q.ResolveAdminPasswordResetUser(
					r.Context(), resetTokenHash,
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[struct{}]{}, &apiProblem{
						details:         adminproblem.InvalidPasswordResetTokenError,
						wwwAuthenticate: adminapi.PasswordResetChallenge,
					}, nil
				}
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				if _, err := q.LockAdminUserCredentialMutation(
					r.Context(), adminUserID,
				); err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				completed, err := q.CompleteAdminPasswordReset(
					r.Context(), sqlc.CompleteAdminPasswordResetParams{
						ResetTokenHash: resetTokenHash,
						PasswordHash:   hash,
					},
				)
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				if !completed {
					return idempotentResult[struct{}]{}, &apiProblem{
						details:         adminproblem.InvalidPasswordResetTokenError,
						wwwAuthenticate: adminapi.PasswordResetChallenge,
					}, nil
				}
				return idempotentResult[struct{}]{
					status: http.StatusNoContent, body: struct{}{},
				}, nil, nil
			},
		)
	}
}

func ChangePassword(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.ChangePasswordRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		hash, err := adminapi.HashPassword(string(request.NewPassword))
		if err != nil {
			s.InternalError(r.Context(), w, "hash changed password", err)
			return
		}
		changed, err := s.Queries.ChangeAdminPassword(
			r.Context(), sqlc.ChangeAdminPasswordParams{
				PasswordHash:          hash,
				TargetAdminUserID:     identity.UserID,
				CurrentAdminSessionID: identity.SessionID,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "change admin password", err)
			return
		}
		if !changed {
			s.Problem(
				r.Context(), w,
				adminproblem.AdminAuthenticationRequiredError,
				adminapi.BearerChallenge,
			)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
