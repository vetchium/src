// Package users contains Admin API user and invitation wire types.
package users

import (
	"time"

	admincommon "github.com/vetchium/src/typespec/admin/common"
	"github.com/vetchium/src/typespec/common"
)

type InviteUserRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r InviteUserRequest) Normalize() InviteUserRequest {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
	return r
}

func (r InviteUserRequest) Validate() []string {
	if !common.IsEmailAddress(r.Normalize().EmailAddress) {
		return []string{"email_address"}
	}
	return []string{}
}

type InviteUserResponse struct {
	AdminInvitationID admincommon.AdminInvitationID `json:"admin_invitation_id"`
	ExpiresAt         time.Time                     `json:"expires_at"`
}

type CompleteSetupRequest struct {
	InvitationToken            admincommon.AdminInvitationToken `json:"invitation_token"`
	Password                   common.NewPassword               `json:"password"`
	DisplayNames               []common.LocalizedDisplayName    `json:"display_names"`
	PrimaryDisplayNameLanguage common.RegionalLanguageCode      `json:"primary_display_name_language"`
	PreferredLanguage          *admincommon.LanguageCode        `json:"preferred_language,omitempty"`
	PreferredTimezone          *common.TimeZoneID               `json:"preferred_timezone,omitempty"`
}

func (r CompleteSetupRequest) Normalize() CompleteSetupRequest {
	r.DisplayNames = normalizeDisplayNames(r.DisplayNames)
	return r
}

func (r CompleteSetupRequest) Validate() []string {
	r = r.Normalize()
	fields := make([]string, 0, 6)
	if !common.IsOpaqueToken(string(r.InvitationToken)) {
		fields = append(fields, "invitation_token")
	}
	if !common.IsNewPassword(r.Password) {
		fields = append(fields, "password")
	}
	displayNamesValid, primaryPresent := validateDisplayNames(
		r.DisplayNames, r.PrimaryDisplayNameLanguage,
	)
	if !displayNamesValid {
		fields = append(fields, "display_names")
	}
	if !common.IsRegionalLanguageCode(r.PrimaryDisplayNameLanguage) ||
		!primaryPresent {
		fields = append(fields, "primary_display_name_language")
	}
	if r.PreferredLanguage != nil &&
		!admincommon.IsLanguageCode(*r.PreferredLanguage) {
		fields = append(fields, "preferred_language")
	}
	if r.PreferredTimezone != nil &&
		!common.IsTimeZoneID(*r.PreferredTimezone) {
		fields = append(fields, "preferred_timezone")
	}
	return fields
}

type CompleteSetupResponse struct {
	AdminUserID admincommon.AdminUserID `json:"admin_user_id"`
}

func normalizeDisplayNames(
	values []common.LocalizedDisplayName,
) []common.LocalizedDisplayName {
	if values == nil {
		return nil
	}
	result := make([]common.LocalizedDisplayName, len(values))
	copy(result, values)
	for index := range result {
		result[index].DisplayName = common.NormalizeDisplayName(
			result[index].DisplayName,
		)
	}
	return result
}

func validateDisplayNames(
	values []common.LocalizedDisplayName,
	primary common.RegionalLanguageCode,
) (bool, bool) {
	if len(values) == 0 {
		return false, false
	}
	seen := make(map[common.RegionalLanguageCode]bool, len(values))
	valid := true
	primaryPresent := false
	for _, value := range values {
		if !common.IsRegionalLanguageCode(value.LanguageCode) ||
			!common.IsDisplayName(value.DisplayName) || seen[value.LanguageCode] {
			valid = false
		}
		seen[value.LanguageCode] = true
		if value.LanguageCode == primary {
			primaryPresent = true
		}
	}
	return valid, primaryPresent
}
