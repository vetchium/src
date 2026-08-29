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
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
)

const passwordResetTTL = 30 * time.Minute

func RequestPasswordReset(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.RequestPasswordResetRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		request = request.Normalize()
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
		w.WriteHeader(http.StatusAccepted)
	}
}

func CompletePasswordReset(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.CompletePasswordResetRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		binding := base64.RawURLEncoding.EncodeToString(credentials.TokenHash(
			string(request.ResetToken),
		))
		handlerauth.RunIdempotent(
			s, w, r, "admin:complete-password-reset", binding, key,
			request, s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				hash, err := credentials.HashPassword(string(request.NewPassword))
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				resetTokenHash := credentials.TokenHash(
					string(request.ResetToken),
				)
				adminUserID, err := q.ResolveAdminPasswordResetUser(
					r.Context(), resetTokenHash,
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Result[struct{}]{}, &handlerauth.Problem{
						Details:         adminproblem.InvalidPasswordResetTokenError,
						WWWAuthenticate: adminapi.PasswordResetChallenge,
					}, nil
				}
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				if _, err := q.LockAdminUserCredentialMutation(
					r.Context(), adminUserID,
				); err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				completed, err := q.CompleteAdminPasswordReset(
					r.Context(), sqlc.CompleteAdminPasswordResetParams{
						ResetTokenHash: resetTokenHash,
						PasswordHash:   hash,
						TenantID:       s.TenantID,
						IdempotencyKey: dbvalue.Text(string(key)),
					},
				)
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				if !completed {
					return handlerauth.Result[struct{}]{}, &handlerauth.Problem{
						Details:         adminproblem.InvalidPasswordResetTokenError,
						WWWAuthenticate: adminapi.PasswordResetChallenge,
					}, nil
				}
				return handlerauth.Result[struct{}]{
					Status: http.StatusNoContent, Body: struct{}{},
				}, nil, nil
			},
		)
	}
}

func ChangePassword(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.ChangePasswordRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		hash, err := credentials.HashPassword(string(request.NewPassword))
		if err != nil {
			s.InternalError(r.Context(), w, "hash changed password", err)
			return
		}
		changed, err := s.Queries.ChangeAdminPassword(
			r.Context(), sqlc.ChangeAdminPasswordParams{
				PasswordHash:          hash,
				TargetAdminUserID:     identity.UserID,
				CurrentAdminSessionID: identity.SessionID,
				TenantID:              s.TenantID,
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
