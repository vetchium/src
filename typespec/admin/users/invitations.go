// Package users contains Admin API user and invitation wire types.
package users

import (
	"time"

	adminspec "github.com/vetchium/src/typespec/admin"
	"github.com/vetchium/src/typespec/admin/authorization"
	"github.com/vetchium/src/typespec/common"
)

type AdminInvitationID string
type AdminInvitationToken common.OpaqueToken

type InviteUserRequest struct {
	EmailAddress common.EmailAddress               `json:"email_address"`
	Permissions  []authorization.AdminPermissionID `json:"permissions,omitempty"`
}

func (r InviteUserRequest) Normalize() InviteUserRequest {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
	return r
}

func (r InviteUserRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !common.IsEmailAddress(r.Normalize().EmailAddress) {
		fields = append(fields, "email_address")
	}
	if !authorization.ValidatePermissions(r.Permissions) {
		fields = append(fields, "permissions")
	}
	return fields
}

type InviteUserResponse struct {
	AdminInvitationID AdminInvitationID `json:"admin_invitation_id"`
	ExpiresAt         time.Time         `json:"expires_at"`
}

type CompleteSetupRequest struct {
	InvitationToken   AdminInvitationToken  `json:"invitation_token"`
	Password          common.NewPassword    `json:"password"`
	DisplayName       common.DisplayName    `json:"display_name"`
	PreferredLanguage common.FrontendLocale `json:"preferred_language"`
}

func (r CompleteSetupRequest) Normalize() CompleteSetupRequest {
	r.DisplayName = common.NormalizeDisplayName(r.DisplayName)
	return r
}

func (r CompleteSetupRequest) Validate() []string {
	r = r.Normalize()
	fields := make([]string, 0, 4)
	if !common.IsOpaqueToken(string(r.InvitationToken)) {
		fields = append(fields, "invitation_token")
	}
	if !common.IsNewPassword(r.Password) {
		fields = append(fields, "password")
	}
	if !common.IsDisplayName(r.DisplayName) {
		fields = append(fields, "display_name")
	}
	if !common.IsFrontendLocale(r.PreferredLanguage) {
		fields = append(fields, "preferred_language")
	}
	return fields
}

type CompleteSetupResponse struct {
	AdminUserID adminspec.AdminUserID `json:"admin_user_id"`
}

func IsAdminInvitationID(value AdminInvitationID) bool {
	return adminspec.IsAdminUserID(adminspec.AdminUserID(value))
}
