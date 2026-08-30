package admin

import (
	"net/http"

	"github.com/vetchium/src/typespec/admin/users"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

func SetPreferredLanguage(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.SetPreferredLanguageRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		_, err := s.Queries.SetAdminPreferredLanguage(
			r.Context(), sqlc.SetAdminPreferredLanguageParams{
				AdminUserID:       identity.UserID,
				PreferredLanguage: string(request.PreferredLanguage),
				TenantID:          s.TenantID,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "set preferred language", err)
			return
		}
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}

func SetDisplayName(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.SetDisplayNameRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		updated, err := s.Queries.SetAdminDisplayName(
			r.Context(), sqlc.SetAdminDisplayNameParams{
				TargetAdminUserID: identity.UserID,
				DisplayName:       string(request.DisplayName),
				TenantID:          s.TenantID,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "set admin display name", err)
			return
		}
		if updated == 0 {
			s.Problem(
				r.Context(), w,
				adminproblem.AdminAuthenticationRequiredError,
				adminapi.BearerChallenge,
			)
			return
		}
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}
