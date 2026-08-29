package hub

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/common"
	hubspec "github.com/vetchium/src/typespec/hub"
	hubusers "github.com/vetchium/src/typespec/hub/users"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	"backend/internal/handlerauth"
	"backend/internal/hubapi"
	"backend/internal/middleware"
)

func MyInfo(s *hubapi.Server) http.HandlerFunc {
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
				s.Problem(
					r.Context(), w,
					hubproblem.AuthenticationRequiredError,
					hubapi.BearerChallenge,
				)
				return
			}
			s.InternalError(r.Context(), w, "get Hub profile", err)
			return
		}
		s.JSON(r.Context(), w, http.StatusOK, hubusers.MyInfoResponse{
			HubUserDID: hubspec.HubUserDID(
				hubapi.FormatUUID(row.HubUserDid),
			),
			Handle:                 hubspec.HubHandle(row.Handle),
			EmailAddress:           common.EmailAddress(row.EmailAddress),
			DisplayName:            common.DisplayName(row.DisplayName),
			PreferredLanguage:      common.FrontendLocale(row.PreferredLanguage),
			ResidentCountry:        common.CountryCode(row.ResidentCountry),
			TOTPEnabled:            row.TotpEnabled,
			RecoveryCodesRemaining: common.TOTPRecoveryCodeCount(row.RecoveryCodesRemaining),
			SessionAuthenticatedAt: row.AuthenticatedAt.Time.UTC(),
		})
	}
}

func SetPreferredLanguage(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubusers.SetPreferredLanguageRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
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
			s.Problem(
				r.Context(), w, hubproblem.AuthenticationRequiredError,
				hubapi.BearerChallenge,
			)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func SetResidentCountry(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubusers.SetResidentCountryRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
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
			s.Problem(
				r.Context(), w, hubproblem.AuthenticationRequiredError,
				hubapi.BearerChallenge,
			)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
