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
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "set preferred language", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func SetDisplayNames(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.SetDisplayNamesRequest
		if err := apiserver.DecodeJSON(r, &request); err != nil {
			s.InvalidJSON(r.Context(), w, err)
			return
		}
		request = request.Normalize()
		if fields := request.Validate(); len(fields) != 0 {
			s.ValidationFailed(r.Context(), w, fields)
			return
		}
		languageCodes := make([]string, len(request.DisplayNames))
		displayNames := make([]string, len(request.DisplayNames))
		for index, displayName := range request.DisplayNames {
			languageCodes[index] = string(displayName.LanguageCode)
			displayNames[index] = string(displayName.DisplayName)
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		updated, err := s.Queries.SetAdminDisplayNames(
			r.Context(), sqlc.SetAdminDisplayNamesParams{
				PrimaryLanguage:   string(request.PrimaryDisplayNameLanguage),
				TargetAdminUserID: identity.UserID,
				LanguageCodes:     languageCodes,
				DisplayNames:      displayNames,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "set admin display names", err)
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
