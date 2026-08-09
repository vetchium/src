package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/admin/authorization"
	admincommon "github.com/vetchium/src/typespec/admin/common"
	"github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/admin/users"
	"github.com/vetchium/src/typespec/common"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

func MyInfo(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			s.Problem(
				r.Context(), w,
				adminproblem.AdminAuthenticationRequiredError,
				`Bearer realm="admin"`,
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
				s.Problem(
					r.Context(), w,
					adminproblem.AdminAuthenticationRequiredError,
					`Bearer realm="admin"`,
				)
				return
			}
			s.InternalError(r.Context(), w, "get admin my-info", err)
			return
		}

		displayNames := make([]common.LocalizedDisplayName, 0)
		if err := json.Unmarshal(
			[]byte(row.DisplayNamesJson), &displayNames,
		); err != nil {
			s.InternalError(r.Context(), w, "decode admin display names", err)
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
			AdminUserID: admincommon.AdminUserID(
				adminapi.FormatUUID(row.AdminUserID),
			),
			EmailAddress:               common.EmailAddress(row.EmailAddress),
			DisplayNames:               displayNames,
			PrimaryDisplayNameLanguage: common.RegionalLanguageCode(row.PrimaryDisplayNameLanguage),
			State:                      user.State(row.AdminUserState),
			AdminAuthorization: authorization.AdminAuthorization{
				IsSuperadmin: row.IsSuperadmin,
				Permissions:  permissions,
			},
			TOTPEnabled: row.TotpEnabled,
			RecoveryCodesRemaining: common.TOTPRecoveryCodeCount(
				row.RecoveryCodesRemaining,
			),
			EffectiveLanguage: admincommon.LanguageCode(
				row.EffectiveLanguage,
			),
			EffectiveTimezone: common.TimeZoneID(row.EffectiveTimezone),
			CreatedAt:         row.CreatedAt.Time,
			SessionExpiresAt:  row.ExpiresAt.Time,
			TenantID:          s.TenantID,
		}
		if row.PreferredLanguage.Valid {
			value := admincommon.LanguageCode(row.PreferredLanguage.String)
			response.PreferredLanguage = &value
		}
		if row.PreferredTimezone.Valid {
			value := common.TimeZoneID(row.PreferredTimezone.String)
			response.PreferredTimezone = &value
		}
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}
