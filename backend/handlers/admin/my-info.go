package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	adminspec "github.com/vetchium/src/typespec/admin"
	adminuser "github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/common"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

func MyInfo(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			s.Unauthorized(w)
			return
		}

		admin, err := s.Queries.GetAdminMyInfo(
			r.Context(),
			sqlc.GetAdminMyInfoParams{
				AdminSessionID: identity.SessionID,
				AdminUserID:    identity.UserID,
			},
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.WarnContext(
					r.Context(), "admin session not found",
					"event", "authentication_failed",
					"reason", "session_not_found",
					"error", err,
				)
				s.Unauthorized(w)
				return
			}
			s.InternalError(
				r.Context(), w, "get admin my-info", err,
			)
			return
		}

		response := adminspec.MyInfoResponse{
			AdminUserID: admin.AdminUserID.String(),
			EmailAddress: common.EmailAddress(
				admin.EmailAddress,
			),
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
			s.ErrorContext(
				r.Context(), "encode admin my-info response",
				"event", "response_encode_error",
				"error", err,
			)
		}
	}
}
