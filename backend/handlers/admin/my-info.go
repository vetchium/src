package admin

import (
	"errors"
	"net/http"

	"backend/internal/adminapi"
	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/httpx"
	"backend/internal/middleware"
	"github.com/jackc/pgx/v5"
	adminspec "github.com/vetchium/src/typespec/admin"
	adminuser "github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"
)

func MyInfo(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			httpx.WriteBearerProblem(w, auth.AdminBearerRealm, problem.NewAuthenticationRequired("Authentication is required."))
			return
		}

		admin, err := s.Queries.GetAdminMyInfo(r.Context(), sqlc.GetAdminMyInfoParams{
			AdminSessionID: identity.SessionID,
			AdminUserID:    identity.UserID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteBearerProblem(w, auth.AdminBearerRealm, problem.NewInvalidSession("The bearer token is invalid or expired."))
				return
			}
			s.ErrorContext(r.Context(), "get admin my-info", "error", err)
			httpx.WriteProblem(w, problem.NewInternalServerError())
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

		if err := httpx.WriteJSON(w, http.StatusOK, response); err != nil {
			s.ErrorContext(r.Context(), "encode admin my-info response", "error", err)
		}
	}
}
