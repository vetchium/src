package admin

import (
	"net/http"

	admincommon "github.com/vetchium/src/typespec/admin/common"
	"github.com/vetchium/src/typespec/admin/company"
	"github.com/vetchium/src/typespec/common"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

func CompanyRegionalDefaults(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		row, err := s.Queries.GetAdminCompanyRegionalDefaults(r.Context())
		if err != nil {
			s.InternalError(
				r.Context(), w, "get company regional defaults", err,
			)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		s.JSON(r.Context(), w, http.StatusOK,
			company.CompanyRegionalDefaultsResponse{
				DefaultLanguage: admincommon.LanguageCode(row.DefaultLanguage),
				DefaultTimezone: common.TimeZoneID(row.DefaultTimezone),
			},
		)
	}
}

func SetCompanyRegionalDefaults(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request company.SetCompanyRegionalDefaultsRequest
		if err := apiserver.DecodeJSON(r, &request); err != nil {
			s.InvalidJSON(r.Context(), w, err)
			return
		}
		if fields := request.Validate(); len(fields) != 0 {
			s.ValidationFailed(r.Context(), w, fields)
			return
		}
		err := s.Queries.SetAdminCompanyRegionalDefaults(
			r.Context(), sqlc.SetAdminCompanyRegionalDefaultsParams{
				DefaultLanguage: string(request.DefaultLanguage),
				DefaultTimezone: string(request.DefaultTimezone),
			},
		)
		if err != nil {
			s.InternalError(
				r.Context(), w, "set company regional defaults", err,
			)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
