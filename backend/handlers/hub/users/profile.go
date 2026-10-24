package users

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	hubspec "github.com/vetchium/src/typespec/hub"
	hubusers "github.com/vetchium/src/typespec/hub/users"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/agencycontacts"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
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
			Handle:                 hubspec.HubHandle(row.Handle),
			EmailAddress:           common.EmailAddress(row.EmailAddress),
			DisplayName:            common.DisplayName(row.DisplayName),
			PreferredLanguage:      hubspec.FrontendLocale(row.PreferredLanguage),
			ResidentCountry:        common.CountryCode(row.ResidentCountry),
			PreferredJobCountries:  jobCountries(row.PreferredJobCountries),
			TOTPEnabled:            row.TotpEnabled,
			RecoveryCodesRemaining: common.TOTPRecoveryCodeCount(row.RecoveryCodesRemaining),
			SessionAuthenticatedAt: row.AuthenticatedAt.Time.UTC(),
			AgenciesMayMessage:     row.AgenciesMayMessage,
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

func SetAgenciesMayMessage(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubusers.SetAgenciesMayMessageRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		tx, err := s.DB.Begin(r.Context())
		if err != nil {
			s.InternalError(r.Context(), w, "begin transaction", err)
			return
		}
		defer func() { _ = tx.Rollback(r.Context()) }()

		q := sqlc.New(tx)
		row, err := q.UpdateHubUserAgenciesMayMessage(r.Context(), sqlc.UpdateHubUserAgenciesMayMessageParams{
			AgenciesMayMessage: request.AgenciesMayMessage,
			HubUserDid:         identity.UserDID,
			TenantID:           s.TenantID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.AuthenticationProblem(
					r.Context(), w, hubproblem.AuthenticationRequiredError,
					hubauthn.BearerChallenge,
				)
				return
			}
			s.InternalError(r.Context(), w, "set Hub agencies may message", err)
			return
		}

		var newReason pgtype.Text
		if !row.AgenciesMayMessage {
			newReason = pgtype.Text{String: "messages_off", Valid: true}
		}
		if _, err := q.SetHubAgencyPointersReadOnlyReasonForUser(r.Context(), sqlc.SetHubAgencyPointersReadOnlyReasonForUserParams{
			HubUserDid:     identity.UserDID,
			ReadOnlyReason: newReason,
		}); err != nil {
			s.InternalError(r.Context(), w, "update agency pointers read only reason", err)
			return
		}

		pointers, err := q.ListHubAgencyPointersForUser(r.Context(), identity.UserDID)
		if err != nil {
			s.InternalError(r.Context(), w, "list agency pointers", err)
			return
		}

		for _, p := range pointers {
			if err := agencycontacts.EnqueueMessagesState(r.Context(), q, agencycontacts.MessagesState{
				ContactID:   p.ContactID,
				OrgDID:      p.AgencyOrgDid,
				HubUserDID:  identity.UserDID,
				Version:     row.AgenciesMayMessageVersion,
				MessagesOff: !row.AgenciesMayMessage,
			}); err != nil {
				s.InternalError(r.Context(), w, "enqueue messages state", err)
				return
			}
		}

		if err := tx.Commit(r.Context()); err != nil {
			s.InternalError(r.Context(), w, "commit transaction", err)
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
