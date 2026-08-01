package admin

import (
	"net/http"
	"time"

	"backend/internal/auth"
	"backend/internal/httpx"
	"backend/internal/middleware"
	"backend/internal/server"
)

type myInfoResponse struct {
	AdminUserID      string     `json:"admin_user_id"`
	EmailAddress     string     `json:"email_address"`
	DisplayName      string     `json:"display_name"`
	AdminUserState   string     `json:"admin_user_state"`
	LastLoginAt      *time.Time `json:"last_login_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	SessionExpiresAt time.Time  `json:"session_expires_at"`
	TenantID         string     `json:"tenant_id"`
}

func MyInfo(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			httpx.WriteBearerProblem(w, auth.AdminBearerRealm, auth.ProblemTypeAuthenticationNeeded, "Authentication required", "Authentication is required.")
			return
		}

		admin := identity.Admin
		response := myInfoResponse{
			AdminUserID:      identity.UserID,
			EmailAddress:     identity.EmailAddress,
			DisplayName:      identity.DisplayName,
			AdminUserState:   string(identity.AdminUserState),
			CreatedAt:        admin.CreatedAt.Time,
			SessionExpiresAt: admin.ExpiresAt.Time,
			TenantID:         s.TenantID,
		}
		if admin.LastLoginAt.Valid {
			lastLoginAt := admin.LastLoginAt.Time
			response.LastLoginAt = &lastLoginAt
		}

		if err := httpx.WriteJSON(w, http.StatusOK, response); err != nil {
			adminLogger(s).ErrorContext(r.Context(), "encode admin my-info response", "error", err)
		}
	}
}
