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
	PreferredLanguage      common.FrontendLocale        `json:"preferred_language"`
	ResidentCountry        common.CountryCode           `json:"resident_country"`
	TOTPEnabled            bool                         `json:"totp_enabled"`
	RecoveryCodesRemaining common.TOTPRecoveryCodeCount `json:"recovery_codes_remaining"`
	SessionAuthenticatedAt time.Time                    `json:"session_authenticated_at"`
}

type SetPreferredLanguageRequest struct {
	PreferredLanguage common.FrontendLocale `json:"preferred_language"`
}

func (r *SetPreferredLanguageRequest) Normalize() {}

func (r SetPreferredLanguageRequest) Validate() []string {
	if !common.IsFrontendLocale(r.PreferredLanguage) {
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
