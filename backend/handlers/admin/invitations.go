package admin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	admincommon "github.com/vetchium/src/typespec/admin/common"
	"github.com/vetchium/src/typespec/admin/users"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

const adminInvitationTTL = 24 * time.Hour

func InviteUser(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.InviteUserRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		request = request.Normalize()
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		binding := adminapi.FormatUUID(identity.UserID)
		now := s.CurrentTime()
		runIdempotent(
			s, w, r, "admin-invite-user", binding, key, request,
			now.Add(adminInvitationTTL),
			func(q *sqlc.Queries) (
				idempotentResult[users.InviteUserResponse],
				*apiProblem, error,
			) {
				token, tokenHash, err := adminapi.NewToken()
				if err != nil {
					return idempotentResult[users.InviteUserResponse]{}, nil, err
				}
				invitationID, err := adminapi.NewUUID()
				if err != nil {
					return idempotentResult[users.InviteUserResponse]{}, nil, err
				}
				payload, err := json.Marshal(struct {
					InvitationToken string `json:"invitation_token"`
					TenantID        string `json:"tenant_id"`
				}{InvitationToken: token, TenantID: s.TenantID})
				if err != nil {
					return idempotentResult[users.InviteUserResponse]{}, nil, err
				}
				ciphertext, err := adminapi.Encrypt(
					s.CredentialSubkey("outbox"), payload,
				)
				if err != nil {
					return idempotentResult[users.InviteUserResponse]{}, nil, err
				}
				expiresAt := now.Add(adminInvitationTTL)
				row, err := q.CreateAdminInvitation(
					r.Context(), sqlc.CreateAdminInvitationParams{
						TargetEmailAddress: string(request.EmailAddress),
						AdminInvitationID:  invitationID,
						TokenHash:          tokenHash,
						InvitedBy:          identity.UserID,
						ExpiresAt:          adminapi.Timestamp(expiresAt),
						PayloadCiphertext:  ciphertext,
					},
				)
				if err != nil {
					return idempotentResult[users.InviteUserResponse]{}, nil, err
				}
				switch row.Result {
				case "user_exists":
					return idempotentResult[users.InviteUserResponse]{},
						&apiProblem{details: adminproblem.AdminUserAlreadyExistsError}, nil
				case "pending":
					return idempotentResult[users.InviteUserResponse]{},
						&apiProblem{details: adminproblem.AdminInvitationAlreadyPendingError}, nil
				}
				if row.ExpiresAt.Valid {
					expiresAt = row.ExpiresAt.Time
				}
				return idempotentResult[users.InviteUserResponse]{
					status: http.StatusCreated,
					body: users.InviteUserResponse{
						AdminInvitationID: admincommon.AdminInvitationID(
							adminapi.FormatUUID(row.AdminInvitationID),
						),
						ExpiresAt: expiresAt,
					},
				}, nil, nil
			},
		)
	}
}

func CompleteSetup(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.CompleteSetupRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		request = request.Normalize()
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		binding := base64.RawURLEncoding.EncodeToString(adminapi.TokenHash(
			string(request.InvitationToken),
		))
		runIdempotent(
			s, w, r, "admin-complete-setup", binding, key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				idempotentResult[users.CompleteSetupResponse],
				*apiProblem, error,
			) {
				passwordHash, err := adminapi.HashPassword(string(request.Password))
				if err != nil {
					return idempotentResult[users.CompleteSetupResponse]{}, nil, err
				}
				newUserID, err := adminapi.NewUUID()
				if err != nil {
					return idempotentResult[users.CompleteSetupResponse]{}, nil, err
				}
				languageCodes := make([]string, len(request.DisplayNames))
				displayNames := make([]string, len(request.DisplayNames))
				primaryDisplayName := ""
				for index, displayName := range request.DisplayNames {
					languageCodes[index] = string(displayName.LanguageCode)
					displayNames[index] = string(displayName.DisplayName)
					if displayName.LanguageCode == request.PrimaryDisplayNameLanguage {
						primaryDisplayName = string(displayName.DisplayName)
					}
				}
				params := sqlc.CompleteAdminSetupParams{
					InvitationTokenHash: adminapi.TokenHash(
						string(request.InvitationToken),
					),
					NewAdminUserID:     newUserID,
					PrimaryDisplayName: primaryDisplayName,
					PasswordHash:       passwordHash,
					PrimaryLanguage:    string(request.PrimaryDisplayNameLanguage),
					LanguageCodes:      languageCodes,
					DisplayNames:       displayNames,
				}
				if request.PreferredLanguage != nil {
					params.PreferredLanguage = pgtype.Text{
						String: string(*request.PreferredLanguage), Valid: true,
					}
				}
				if request.PreferredTimezone != nil {
					params.PreferredTimezone = pgtype.Text{
						String: string(*request.PreferredTimezone), Valid: true,
					}
				}
				row, err := q.CompleteAdminSetup(r.Context(), params)
				if err != nil {
					return idempotentResult[users.CompleteSetupResponse]{}, nil, err
				}
				switch row.Result {
				case "invalid_token":
					return idempotentResult[users.CompleteSetupResponse]{},
						&apiProblem{
							details:         adminproblem.InvalidInvitationTokenError,
							wwwAuthenticate: adminapi.InvitationChallenge,
						}, nil
				case "user_exists":
					return idempotentResult[users.CompleteSetupResponse]{},
						&apiProblem{details: adminproblem.AdminUserAlreadyExistsError}, nil
				}
				return idempotentResult[users.CompleteSetupResponse]{
					status: http.StatusCreated,
					body: users.CompleteSetupResponse{
						AdminUserID: admincommon.AdminUserID(
							adminapi.FormatUUID(row.AdminUserID),
						),
					},
				}, nil, nil
			},
		)
	}
}
