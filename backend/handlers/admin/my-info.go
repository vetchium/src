package admin

import (
	"errors"
	"net/http"
	"time"

	"backend/internal/adminapi"
	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/httpx"
	"backend/internal/middleware"
	"github.com/jackc/pgx/v5"
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

func MyInfo(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			httpx.WriteBearerProblem(w, auth.AdminBearerRealm, auth.ProblemTypeAuthenticationNeeded, "Authentication required", "Authentication is required.")
			return
		}

		admin, err := s.Queries.GetAdminMyInfo(r.Context(), sqlc.GetAdminMyInfoParams{
			AdminSessionID: identity.SessionID,
			AdminUserID:    identity.UserID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteBearerProblem(w, auth.AdminBearerRealm, auth.ProblemTypeInvalidSession, "Invalid session", "The bearer token is invalid or expired.")
				return
			}
			adminLogger(s).ErrorContext(r.Context(), "get admin my-info", "error", err)
			httpx.WriteProblem(w, http.StatusInternalServerError, "The request could not be completed.")
			return
		}

		response := myInfoResponse{
			AdminUserID:      admin.AdminUserID.String(),
			EmailAddress:     admin.EmailAddress,
			DisplayName:      admin.DisplayName,
			AdminUserState:   string(admin.AdminUserState),
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
