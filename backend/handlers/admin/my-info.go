package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"backend/internal/adminapi"
	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
	"github.com/jackc/pgx/v5"
	adminspec "github.com/vetchium/src/typespec/admin"
	adminuser "github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/common"
	problemspec "github.com/vetchium/src/typespec/problem"
)

func MyInfo(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			auth.Unauthorized(w, auth.AdminBearerRealm)
			return
		}

		admin, err := s.Queries.GetAdminMyInfo(r.Context(), sqlc.GetAdminMyInfoParams{
			AdminSessionID: identity.SessionID,
			AdminUserID:    identity.UserID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				auth.Unauthorized(w, auth.AdminBearerRealm)
				return
			}
			s.ErrorContext(r.Context(), "get admin my-info", "error", err)
			w.Header().Set("Content-Type", problemspec.MediaType)
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(problemspec.InternalServerErrorBody))
			return
		}

		response := adminspec.MyInfoResponse{
			AdminUserID:      admin.AdminUserID.String(),
			EmailAddress:     common.EmailAddress(admin.EmailAddress),
			DisplayName:      admin.DisplayName,
			AdminUserState:   adminuser.State(admin.AdminUserState),
			CreatedAt:        admin.CreatedAt.Time,
			SessionExpiresAt: admin.ExpiresAt.Time,
			TenantID:         s.TenantID,
		}
		if admin.LastLoginAt.Valid {
			lastLoginAt := admin.LastLoginAt.Time
			response.LastLoginAt = &lastLoginAt
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.ErrorContext(r.Context(), "encode admin my-info response", "error", err)
		}
	}
}
