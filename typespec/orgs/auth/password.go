package auth

import (
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
)

type OrgPasswordResetToken common.OpaqueToken

type RequestPasswordResetRequest struct {
	Domain       orgs.OrgDomain      `json:"domain"`
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r *RequestPasswordResetRequest) Normalize() {
	r.Domain = orgs.NormalizeOrgDomain(r.Domain)
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
}

func (r RequestPasswordResetRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !orgs.IsOrgDomain(r.Domain) {
		fields = append(fields, "domain")
	}
	if !common.IsEmailAddress(r.EmailAddress) {
		fields = append(fields, "email_address")
	}
	return fields
}

type CompletePasswordResetRequest struct {
	ResetToken  OrgPasswordResetToken `json:"reset_token"`
	NewPassword common.NewPassword    `json:"new_password"`
}

func (r *CompletePasswordResetRequest) Normalize() {}

func (r CompletePasswordResetRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !common.IsOpaqueToken(string(r.ResetToken)) {
		fields = append(fields, "reset_token")
	}
	if !common.IsNewPassword(r.NewPassword) {
		fields = append(fields, "new_password")
	}
	return fields
}

type ChangePasswordRequest struct {
	NewPassword common.NewPassword `json:"new_password"`
}

func (r *ChangePasswordRequest) Normalize() {}

func (r ChangePasswordRequest) Validate() []string {
	if !common.IsNewPassword(r.NewPassword) {
		return []string{"new_password"}
	}
	return []string{}
}
