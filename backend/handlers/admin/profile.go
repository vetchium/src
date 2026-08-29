package admin

import (
	"net/http"

	"github.com/vetchium/src/typespec/admin/users"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
)

func SetPreferredLanguage(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.SetPreferredLanguageRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
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
		w.WriteHeader(http.StatusNoContent)
	}
}

func SetDisplayName(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.SetDisplayNameRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			request = request.Normalize()
			return request.Validate()
		}) {
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
		w.WriteHeader(http.StatusNoContent)
	}
}
