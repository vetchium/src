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
		if err := apiserver.DecodeJSON(r, &request); err != nil {
			s.InvalidJSON(r.Context(), w, err)
			return
		}
		if fields := request.Validate(); len(fields) != 0 {
			s.ValidationFailed(r.Context(), w, fields)
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
		if err := apiserver.DecodeJSON(r, &request); err != nil {
			s.InvalidJSON(r.Context(), w, err)
			return
		}
		request = request.Normalize()
		if fields := request.Validate(); len(fields) != 0 {
			s.ValidationFailed(r.Context(), w, fields)
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
