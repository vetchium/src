package auth

import (
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
)

type HubSignupToken common.OpaqueToken

type RequestSignupRequest struct {
	EmailAddress      common.EmailAddress   `json:"email_address"`
	DisplayName       common.DisplayName    `json:"display_name"`
	PreferredLanguage common.FrontendLocale `json:"preferred_language"`
	ResidentCountry   common.CountryCode    `json:"resident_country"`
}

func (r *RequestSignupRequest) Normalize() {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
	r.DisplayName = common.NormalizeDisplayName(r.DisplayName)
}

func (r RequestSignupRequest) Validate() []string {
	fields := make([]string, 0, 4)
	if !common.IsEmailAddress(r.EmailAddress) {
		fields = append(fields, "email_address")
	}
	if !common.IsDisplayName(r.DisplayName) {
		fields = append(fields, "display_name")
	}
	if !common.IsFrontendLocale(r.PreferredLanguage) {
		fields = append(fields, "preferred_language")
	}
	if !common.IsCountryCode(r.ResidentCountry) {
		fields = append(fields, "resident_country")
	}
	return fields
}

type CompleteSignupRequest struct {
	SignupToken HubSignupToken     `json:"signup_token"`
	Password    common.NewPassword `json:"password"`
}

func (r *CompleteSignupRequest) Normalize() {}

func (r CompleteSignupRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !common.IsOpaqueToken(string(r.SignupToken)) {
		fields = append(fields, "signup_token")
	}
	if !common.IsNewPassword(r.Password) {
		fields = append(fields, "password")
	}
	return fields
}

type CompleteSignupResponse struct {
	HubUserDID hub.HubUserDID `json:"hub_user_did"`
	Handle     hub.HubHandle  `json:"handle"`
}
