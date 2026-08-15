// Package auth contains Admin API authentication wire types.
package auth

import (
	"time"

	"github.com/vetchium/src/typespec/common"
)

type LoginRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
	Password     common.Password     `json:"password"`
}

func (r LoginRequest) Normalize() LoginRequest {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
	return r
}

func (r LoginRequest) Validate() []string {
	r = r.Normalize()
	fields := make([]string, 0, 2)
	if !common.IsEmailAddress(r.EmailAddress) {
		fields = append(fields, "email_address")
	}
	if r.Password == "" {
		fields = append(fields, "password")
	}
	return fields
}

type AuthenticationState string

const (
	AuthenticationStateAuthenticated AuthenticationState = "authenticated"
	AuthenticationStateTOTPRequired  AuthenticationState = "totp_required"
)

type LoginAuthenticatedResponse struct {
	AuthenticationState AuthenticationState `json:"authentication_state"`
	AuthenticatedSessionResponse
}

type LoginTOTPRequiredResponse struct {
	AuthenticationState     AuthenticationState      `json:"authentication_state"`
	LoginChallengeToken     AdminLoginChallengeToken `json:"login_challenge_token"`
	LoginChallengeExpiresAt time.Time                `json:"login_challenge_expires_at"`
}

type VerifyTFARequest struct {
	LoginChallengeToken AdminLoginChallengeToken `json:"login_challenge_token"`
	TOTPCode            common.TOTPCode          `json:"totp_code"`
}

func (r VerifyTFARequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !common.IsOpaqueToken(string(r.LoginChallengeToken)) {
		fields = append(fields, "login_challenge_token")
	}
	if !common.IsTOTPCode(r.TOTPCode) {
		fields = append(fields, "totp_code")
	}
	return fields
}
