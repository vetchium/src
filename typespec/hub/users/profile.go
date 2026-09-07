// Package users contains Hub profile wire types.
package users

import (
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
)

type MyInfoResponse struct {
	HubUserDID             hub.HubUserDID               `json:"hub_user_did"`
	Handle                 hub.HubHandle                `json:"handle"`
	EmailAddress           common.EmailAddress          `json:"email_address"`
	DisplayName            common.DisplayName           `json:"display_name"`
	PreferredLanguage      hub.FrontendLocale           `json:"preferred_language"`
	PreferredJobCountries  []common.CountryCode         `json:"preferred_job_countries"`
	ResidentCountry        common.CountryCode           `json:"resident_country"`
	TOTPEnabled            bool                         `json:"totp_enabled"`
	RecoveryCodesRemaining common.TOTPRecoveryCodeCount `json:"recovery_codes_remaining"`
	SessionAuthenticatedAt time.Time                    `json:"session_authenticated_at"`
}

type SetPreferredLanguageRequest struct {
	PreferredLanguage hub.FrontendLocale `json:"preferred_language"`
}

func (r *SetPreferredLanguageRequest) Normalize() {}

func (r SetPreferredLanguageRequest) Validate() []string {
	if !hub.IsFrontendLocale(r.PreferredLanguage) {
		return []string{"preferred_language"}
	}
	return []string{}
}

type SetResidentCountryRequest struct {
	ResidentCountry common.CountryCode `json:"resident_country"`
}

func (r *SetResidentCountryRequest) Normalize() {}

func (r SetResidentCountryRequest) Validate() []string {
	if !common.IsCountryCode(r.ResidentCountry) {
		return []string{"resident_country"}
	}
	return []string{}
}

// An empty preference means the user has no country filter.
type SetPreferredJobCountriesRequest struct {
	PreferredJobCountries []common.CountryCode `json:"preferred_job_countries"`
}

func (r *SetPreferredJobCountriesRequest) Normalize() {}
func (r SetPreferredJobCountriesRequest) Validate() []string {
	if r.PreferredJobCountries == nil || len(r.PreferredJobCountries) > 10 {
		return []string{"preferred_job_countries"}
	}
	seen := map[common.CountryCode]bool{}
	for _, country := range r.PreferredJobCountries {
		if !common.IsCountryCode(country) || seen[country] {
			return []string{"preferred_job_countries"}
		}
		seen[country] = true
	}
	return []string{}
}
