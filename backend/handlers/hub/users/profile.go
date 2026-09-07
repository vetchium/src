package users

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/common"
	hubspec "github.com/vetchium/src/typespec/hub"
	hubusers "github.com/vetchium/src/typespec/hub/users"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/middleware"
)

func MyInfo(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		row, err := s.Queries.GetHubMyInfo(
			r.Context(), sqlc.GetHubMyInfoParams{
				HubSessionID: identity.SessionID,
				HubUserDid:   identity.UserDID,
			},
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.AuthenticationProblem(
					r.Context(), w,
					hubproblem.AuthenticationRequiredError,
					hubauthn.BearerChallenge,
				)
				return
			}
			s.InternalError(r.Context(), w, "get Hub profile", err)
			return
		}
		s.JSON(r.Context(), w, http.StatusOK, hubusers.MyInfoResponse{
			HubUserDID: hubspec.HubUserDID(
				dbvalue.FormatUUID(row.HubUserDid),
			),
			Handle:                 hubspec.HubHandle(row.Handle),
			EmailAddress:           common.EmailAddress(row.EmailAddress),
			DisplayName:            common.DisplayName(row.DisplayName),
			PreferredLanguage:      hubspec.FrontendLocale(row.PreferredLanguage),
			ResidentCountry:        common.CountryCode(row.ResidentCountry),
			PreferredJobCountries:  jobCountries(row.PreferredJobCountries),
			TOTPEnabled:            row.TotpEnabled,
			RecoveryCodesRemaining: common.TOTPRecoveryCodeCount(row.RecoveryCodesRemaining),
			SessionAuthenticatedAt: row.AuthenticatedAt.Time.UTC(),
		})
	}
}

func SetPreferredLanguage(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubusers.SetPreferredLanguageRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		changed, err := s.Queries.SetHubPreferredLanguage(
			r.Context(), sqlc.SetHubPreferredLanguageParams{
				PreferredLanguage: string(request.PreferredLanguage),
				HubUserDid:        identity.UserDID,
				TenantID:          s.TenantID,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "set Hub preferred language", err)
			return
		}
		if !changed {
			s.AuthenticationProblem(
				r.Context(), w, hubproblem.AuthenticationRequiredError,
				hubauthn.BearerChallenge,
			)
			return
		}
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}

func SetResidentCountry(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubusers.SetResidentCountryRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		changed, err := s.Queries.SetHubResidentCountry(
			r.Context(), sqlc.SetHubResidentCountryParams{
				ResidentCountry: string(request.ResidentCountry),
				HubUserDid:      identity.UserDID,
				TenantID:        s.TenantID,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "set Hub resident country", err)
			return
		}
		if !changed {
			s.AuthenticationProblem(
				r.Context(), w, hubproblem.AuthenticationRequiredError,
				hubauthn.BearerChallenge,
			)
			return
		}
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}

func SetPreferredJobCountries(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubusers.SetPreferredJobCountriesRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		changed, err := s.Queries.SetHubPreferredJobCountries(
			r.Context(), sqlc.SetHubPreferredJobCountriesParams{
				PreferredJobCountries: countryStrings(request.PreferredJobCountries),
				HubUserDid:            identity.UserDID,
				TenantID:              s.TenantID,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "set Hub preferred job countries", err)
			return
		}
		if !changed {
			s.AuthenticationProblem(
				r.Context(), w, hubproblem.AuthenticationRequiredError,
				hubauthn.BearerChallenge,
			)
			return
		}
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}

func jobCountries(values []string) []common.CountryCode {
	result := make([]common.CountryCode, 0, len(values))
	for _, value := range values {
		result = append(result, common.CountryCode(value))
	}
	return result
}
func countryStrings(values []common.CountryCode) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, string(value))
	}
	return result
}
