package admin

import (
	"encoding/json"
	"net/http"
	"time"

	"backend/internal/middleware"
	"backend/internal/server"
)

type myInfoResponse struct {
	AdminUserID    string     `json:"admin_user_id"`
	EmailAddress   string     `json:"email_address"`
	DisplayName    string     `json:"display_name"`
	AdminUserState string     `json:"admin_user_state"`
	LastLoginAt    *time.Time `json:"last_login_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

func MyInfo(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		admin := identity.Admin
		response := myInfoResponse{
			AdminUserID:    identity.UserID,
			EmailAddress:   identity.EmailAddress,
			DisplayName:    identity.DisplayName,
			AdminUserState: string(identity.AdminUserState),
			CreatedAt:      admin.CreatedAt.Time,
		}
		if admin.LastLoginAt.Valid {
			lastLoginAt := admin.LastLoginAt.Time
			response.LastLoginAt = &lastLoginAt
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			adminLogger(s).ErrorContext(r.Context(), "encode admin my-info response", "error", err)
		}
	}
}
