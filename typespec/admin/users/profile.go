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

type SetDisplayNameRequest struct {
	DisplayName common.DisplayName `json:"display_name"`
}

func (r SetDisplayNameRequest) Normalize() SetDisplayNameRequest {
	r.DisplayName = common.NormalizeDisplayName(r.DisplayName)
	return r
}

func (r SetDisplayNameRequest) Validate() []string {
	r = r.Normalize()
	if !common.IsDisplayName(r.DisplayName) {
		return []string{"display_name"}
	}
	return []string{}
}

type MyInfoResponse struct {
	AdminUserID  adminspec.AdminUserID `json:"admin_user_id"`
	EmailAddress common.EmailAddress   `json:"email_address"`
	DisplayName  common.DisplayName    `json:"display_name"`
	State        user.State            `json:"state"`
	authorization.AdminAuthorization
	TOTPEnabled            bool                         `json:"totp_enabled"`
	RecoveryCodesRemaining common.TOTPRecoveryCodeCount `json:"recovery_codes_remaining"`
	PreferredLanguage      common.FrontendLocale        `json:"preferred_language"`
	CreatedAt              time.Time                    `json:"created_at"`
	SessionAuthenticatedAt time.Time                    `json:"session_authenticated_at"`
	SessionExpiresAt       time.Time                    `json:"session_expires_at"`
	TenantID               string                       `json:"tenant_id"`
}
