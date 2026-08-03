package admin

import (
	"net/http"

	"backend/internal/adminapi"
	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
	problemspec "github.com/vetchium/src/typespec/problem"
)

func Logout(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			auth.Unauthorized(w, auth.AdminBearerRealm)
			return
		}

		deleted, err := s.Queries.DeleteAdminSession(r.Context(), sqlc.DeleteAdminSessionParams{
			AdminSessionID: identity.SessionID,
			AdminUserID:    identity.UserID,
		})
		if err != nil {
			s.ErrorContext(r.Context(), "delete admin session", "error", err)
			w.Header().Set("Content-Type", problemspec.MediaType)
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(problemspec.InternalServerErrorBody))
			return
		}
		if deleted == 0 {
			auth.Unauthorized(w, auth.AdminBearerRealm)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
