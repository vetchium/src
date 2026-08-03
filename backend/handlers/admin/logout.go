package admin

import (
	"net/http"

	"backend/internal/adminapi"
	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/httpx"
	"backend/internal/middleware"
	"github.com/vetchium/src/typespec/problem"
)

func Logout(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			httpx.WriteBearerProblem(w, auth.AdminBearerRealm, problem.NewAuthenticationRequired("Authentication is required."))
			return
		}

		deleted, err := s.Queries.DeleteAdminSession(r.Context(), sqlc.DeleteAdminSessionParams{
			AdminSessionID: identity.SessionID,
			AdminUserID:    identity.UserID,
		})
		if err != nil {
			s.ErrorContext(r.Context(), "delete admin session", "error", err)
			httpx.WriteProblem(w, problem.NewInternalServerError())
			return
		}
		if deleted == 0 {
			httpx.WriteBearerProblem(w, auth.AdminBearerRealm, problem.NewInvalidSession("The session is no longer valid."))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
