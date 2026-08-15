package users

import (
	"time"

	adminspec "github.com/vetchium/src/typespec/admin"
	"github.com/vetchium/src/typespec/admin/authorization"
	"github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/common"
)

type SetPreferredLanguageRequest struct {
	PreferredLanguage common.FrontendLocale `json:"preferred_language"`
}

func (r SetPreferredLanguageRequest) Validate() []string {
	if !common.IsFrontendLocale(r.PreferredLanguage) {
		return []string{"preferred_language"}
	}
	return []string{}
}

type SetDisplayNamesRequest struct {
	DisplayNames               []common.LocalizedDisplayName `json:"display_names"`
	PrimaryDisplayNameLanguage common.RegionalLanguageCode   `json:"primary_display_name_language"`
}

func (r SetDisplayNamesRequest) Normalize() SetDisplayNamesRequest {
	r.DisplayNames = normalizeDisplayNames(r.DisplayNames)
	return r
}

func (r SetDisplayNamesRequest) Validate() []string {
	r = r.Normalize()
	valid, primaryPresent := validateDisplayNames(
		r.DisplayNames, r.PrimaryDisplayNameLanguage,
	)
	fields := make([]string, 0, 2)
	if !valid {
		fields = append(fields, "display_names")
	}
	if !common.IsRegionalLanguageCode(r.PrimaryDisplayNameLanguage) ||
		!primaryPresent {
		fields = append(fields, "primary_display_name_language")
	}
	return fields
}

type MyInfoResponse struct {
	AdminUserID                adminspec.AdminUserID         `json:"admin_user_id"`
	EmailAddress               common.EmailAddress           `json:"email_address"`
	DisplayNames               []common.LocalizedDisplayName `json:"display_names"`
	PrimaryDisplayNameLanguage common.RegionalLanguageCode   `json:"primary_display_name_language"`
	State                      user.State                    `json:"state"`
	authorization.AdminAuthorization
	TOTPEnabled            bool                         `json:"totp_enabled"`
	RecoveryCodesRemaining common.TOTPRecoveryCodeCount `json:"recovery_codes_remaining"`
	PreferredLanguage      common.FrontendLocale        `json:"preferred_language"`
	CreatedAt              time.Time                    `json:"created_at"`
	SessionAuthenticatedAt time.Time                    `json:"session_authenticated_at"`
	SessionExpiresAt       time.Time                    `json:"session_expires_at"`
	TenantID               string                       `json:"tenant_id"`
}
