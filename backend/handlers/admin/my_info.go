package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	adminspec "github.com/vetchium/src/typespec/admin"
	"github.com/vetchium/src/typespec/admin/authorization"
	"github.com/vetchium/src/typespec/admin/users"
	"github.com/vetchium/src/typespec/common"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
)

func MyInfo(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			s.AuthenticationProblem(
				r.Context(), w,
				adminproblem.AdminAuthenticationRequiredError,
				adminapi.BearerChallenge,
			)
			return
		}
		row, err := s.Queries.GetAdminMyInfo(
			r.Context(), sqlc.GetAdminMyInfoParams{
				AdminSessionID: identity.SessionID,
				AdminUserID:    identity.UserID,
			},
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.AuthenticationProblem(
					r.Context(), w,
					adminproblem.AdminAuthenticationRequiredError,
					adminapi.BearerChallenge,
				)
				return
			}
			s.InternalError(r.Context(), w, "get admin my-info", err)
			return
		}

		var permissionValues []string
		if err := json.Unmarshal(
			[]byte(row.PermissionsJson), &permissionValues,
		); err != nil {
			s.InternalError(r.Context(), w, "decode admin permissions", err)
			return
		}
		permissions := make([]authorization.AdminPermissionID, len(permissionValues))
		for index, permission := range permissionValues {
			permissions[index] = authorization.AdminPermissionID(permission)
		}
		response := users.MyInfoResponse{
			AdminUserID: adminspec.AdminUserID(
				dbvalue.FormatUUID(row.AdminUserID),
			),
			EmailAddress: common.EmailAddress(row.EmailAddress),
			DisplayName:  common.DisplayName(row.DisplayName),
			State:        users.AdminUserState(row.AdminUserState),
			AdminAuthorization: authorization.AdminAuthorization{
				Permissions: permissions,
			},
			TOTPEnabled: row.TotpEnabled,
			RecoveryCodesRemaining: common.TOTPRecoveryCodeCount(
				row.RecoveryCodesRemaining,
			),
			PreferredLanguage:      common.FrontendLocale(row.PreferredLanguage),
			CreatedAt:              row.CreatedAt.Time.UTC(),
			SessionAuthenticatedAt: identity.AuthenticatedAt.UTC(),
			SessionExpiresAt:       row.ExpiresAt.Time.UTC(),
			TenantID:               s.TenantID,
		}
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}
