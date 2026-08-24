package auth

import "github.com/vetchium/src/typespec/common"

type HubPasswordResetToken common.OpaqueToken

type RequestPasswordResetRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r RequestPasswordResetRequest) Normalize() RequestPasswordResetRequest {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
	return r
}

func (r RequestPasswordResetRequest) Validate() []string {
	if !common.IsEmailAddress(r.Normalize().EmailAddress) {
		return []string{"email_address"}
	}
	return []string{}
}

type CompletePasswordResetRequest struct {
	ResetToken  HubPasswordResetToken `json:"reset_token"`
	NewPassword common.NewPassword    `json:"new_password"`
}

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

func (r ChangePasswordRequest) Validate() []string {
	if !common.IsNewPassword(r.NewPassword) {
		return []string{"new_password"}
	}
	return []string{}
}
