package users

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"

	adminspec "github.com/vetchium/src/typespec/admin"
	"github.com/vetchium/src/typespec/admin/authorization"
	"github.com/vetchium/src/typespec/admin/users"
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

const adminInvitationTTL = 24 * time.Hour

func InviteUser(s *adminruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.InviteUserRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		granted := authorization.DirectPermissions(request.Permissions)
		permissions := make([]string, len(granted))
		for index, permission := range granted {
			permissions[index] = string(permission)
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		binding := dbvalue.FormatUUID(identity.UserID)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "admin:invite-user", binding, key, request,
			now.Add(adminInvitationTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[users.InviteUserResponse],
				*handlerauth.Problem, error,
			) {
				token, tokenHash, err := credentials.NewToken()
				if err != nil {
					return handlerauth.Result[users.InviteUserResponse]{}, nil, err
				}
				invitationID, err := dbvalue.NewUUID()
				if err != nil {
					return handlerauth.Result[users.InviteUserResponse]{}, nil, err
				}
				payload, err := json.Marshal(struct {
					InvitationToken string `json:"invitation_token"`
					TenantID        string `json:"tenant_id"`
				}{InvitationToken: token, TenantID: s.TenantID})
				if err != nil {
					return handlerauth.Result[users.InviteUserResponse]{}, nil, err
				}
				ciphertext, err := credentials.Encrypt(
					s.CredentialSubkey("outbox"), payload,
				)
				if err != nil {
					return handlerauth.Result[users.InviteUserResponse]{}, nil, err
				}
				expiresAt := now.Add(adminInvitationTTL)
				row, err := q.CreateAdminInvitation(
					r.Context(), sqlc.CreateAdminInvitationParams{
						TargetEmailAddress: string(request.EmailAddress),
						AdminInvitationID:  invitationID,
						TokenHash:          tokenHash,
						Permissions:        permissions,
						InvitedBy:          identity.UserID,
						ExpiresAt:          dbvalue.Timestamp(expiresAt),
						PayloadCiphertext:  ciphertext,
						TenantID:           s.TenantID,
						IdempotencyKey:     dbvalue.Text(string(key)),
					},
				)
				if err != nil {
					return handlerauth.Result[users.InviteUserResponse]{}, nil, err
				}
				switch row.Result {
				case "user_exists":
					return handlerauth.Result[users.InviteUserResponse]{},
						&handlerauth.Problem{Details: adminproblem.AdminUserAlreadyExistsError}, nil
				case "pending":
					return handlerauth.Result[users.InviteUserResponse]{},
						&handlerauth.Problem{Details: adminproblem.AdminInvitationAlreadyPendingError}, nil
				}
				if row.ExpiresAt.Valid {
					expiresAt = row.ExpiresAt.Time
				}
				return handlerauth.Result[users.InviteUserResponse]{
					Status: http.StatusCreated,
					Body: users.InviteUserResponse{
						AdminInvitationID: users.AdminInvitationID(
							dbvalue.FormatUUID(row.AdminInvitationID),
						),
						ExpiresAt: expiresAt.UTC(),
					},
				}, nil, nil
			},
		)
	}
}

func CompleteSetup(s *adminruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.CompleteSetupRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		binding := base64.RawURLEncoding.EncodeToString(credentials.TokenHash(
			string(request.InvitationToken),
		))
		handlerauth.RunIdempotent(
			s, w, r, "admin:complete-setup", binding, key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[users.CompleteSetupResponse],
				*handlerauth.Problem, error,
			) {
				passwordHash, err := credentials.HashPassword(string(request.Password))
				if err != nil {
					return handlerauth.Result[users.CompleteSetupResponse]{}, nil, err
				}
				newUserID, err := dbvalue.NewUUID()
				if err != nil {
					return handlerauth.Result[users.CompleteSetupResponse]{}, nil, err
				}
				params := sqlc.CompleteAdminSetupParams{
					InvitationTokenHash: credentials.TokenHash(
						string(request.InvitationToken),
					),
					NewAdminUserID:    newUserID,
					DisplayName:       string(request.DisplayName),
					PasswordHash:      passwordHash,
					PreferredLanguage: string(request.PreferredLanguage),
					TenantID:          s.TenantID,
					IdempotencyKey:    dbvalue.Text(string(key)),
				}
				row, err := q.CompleteAdminSetup(r.Context(), params)
				if err != nil {
					return handlerauth.Result[users.CompleteSetupResponse]{}, nil, err
				}
				switch row.Result {
				case "invalid_token":
					return handlerauth.AuthenticationFailure[users.CompleteSetupResponse](
						adminproblem.InvalidInvitationTokenError,
						adminauthn.InvitationChallenge,
					)
				case "user_exists":
					return handlerauth.Result[users.CompleteSetupResponse]{},
						&handlerauth.Problem{Details: adminproblem.AdminUserAlreadyExistsError}, nil
				}
				return handlerauth.Result[users.CompleteSetupResponse]{
					Status: http.StatusCreated,
					Body: users.CompleteSetupResponse{
						AdminUserID: adminspec.AdminUserID(
							dbvalue.FormatUUID(row.AdminUserID),
						),
					},
				}, nil, nil
			},
		)
	}
}
