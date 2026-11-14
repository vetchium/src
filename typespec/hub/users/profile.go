// Package users contains Hub profile wire types.
package users

import (
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
)

type MyInfoResponse struct {
	Handle                   hub.HubHandle                `json:"handle"`
	EmailAddress             common.EmailAddress          `json:"email_address"`
	DisplayName              common.DisplayName           `json:"display_name"`
	PreferredLanguage        hub.FrontendLocale           `json:"preferred_language"`
	PreferredJobCountries    []common.CountryCode         `json:"preferred_job_countries"`
	ResidentCountry          common.CountryCode           `json:"resident_country"`
	TOTPEnabled              bool                         `json:"totp_enabled"`
	RecoveryCodesRemaining   common.TOTPRecoveryCodeCount `json:"recovery_codes_remaining"`
	SessionAuthenticatedAt   time.Time                    `json:"session_authenticated_at"`
	AgenciesMayMessage       bool                         `json:"agencies_may_message"`
	IdealJob                 *hub.IdealJob                `json:"ideal_job,omitempty"`
	LookingForJob            bool                         `json:"looking_for_job"`
	JobSearchPromptDismissed bool                         `json:"job_search_prompt_dismissed"`
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

type SetAgenciesMayMessageRequest struct {
	// AgenciesMayMessage is "Agencies may send me chat requests"
	// (MKT-REQ-008): off refuses only new agency requests, and accepted
	// conversations continue.
	AgenciesMayMessage *bool `json:"agencies_may_message"`
}

func (r *SetAgenciesMayMessageRequest) Normalize() {}

func (r SetAgenciesMayMessageRequest) Validate() []string {
	if r.AgenciesMayMessage == nil {
		return []string{"agencies_may_message"}
	}
	return []string{}
}

// SetIdealJobRequest removes the ideal job when IdealJob is empty after
// trimming (PROF-JOB-001). A missing value is refused rather than read as
// empty, so a malformed client cannot clear it by accident.
type SetIdealJobRequest struct {
	IdealJob *string `json:"ideal_job"`
}

func (r *SetIdealJobRequest) Normalize() {
	if r.IdealJob != nil {
		trimmed := strings.TrimSpace(*r.IdealJob)
		r.IdealJob = &trimmed
	}
}

func (r SetIdealJobRequest) Validate() []string {
	if r.IdealJob == nil ||
		utf8.RuneCountInString(*r.IdealJob) > hub.MaxIdealJobCodePoints {
		return []string{"ideal_job"}
	}
	return []string{}
}

type SetLookingForJobRequest struct {
	LookingForJob *bool `json:"looking_for_job"`
}

func (r *SetLookingForJobRequest) Normalize() {}

func (r SetLookingForJobRequest) Validate() []string {
	if r.LookingForJob == nil {
		return []string{"looking_for_job"}
	}
	return []string{}
}

type DismissJobSearchPromptRequest struct{}

func (r *DismissJobSearchPromptRequest) Normalize() {}

func (r DismissJobSearchPromptRequest) Validate() []string {
	return []string{}
}
