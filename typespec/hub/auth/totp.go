package auth

import (
	"time"

	"github.com/vetchium/src/typespec/common"
)

type StartTOTPEnrollmentResponse struct {
	TOTPEnrollmentToken common.TOTPEnrollmentToken `json:"totp_enrollment_token"`
	ProvisioningURI     string                     `json:"provisioning_uri"`
	ManualEntryKey      common.TOTPManualEntryKey  `json:"manual_entry_key"`
	Configuration       common.TOTPConfiguration   `json:"configuration"`
	ExpiresAt           time.Time                  `json:"expires_at"`
}

type ConfirmTOTPEnrollmentRequest struct {
	TOTPEnrollmentToken common.TOTPEnrollmentToken `json:"totp_enrollment_token"`
	TOTPCode            common.TOTPCode            `json:"totp_code"`
}

func (r *ConfirmTOTPEnrollmentRequest) Normalize() {}

func (r ConfirmTOTPEnrollmentRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !common.IsOpaqueToken(string(r.TOTPEnrollmentToken)) {
		fields = append(fields, "totp_enrollment_token")
	}
	if !common.IsTOTPCode(r.TOTPCode) {
		fields = append(fields, "totp_code")
	}
	return fields
}

type ConfirmTOTPEnrollmentResponse struct {
	RecoveryCodes []common.TOTPRecoveryCode `json:"recovery_codes"`
}

type VerifyRecoveryCodeRequest struct {
	LoginChallengeToken HubLoginChallengeToken  `json:"login_challenge_token"`
	RecoveryCode        common.TOTPRecoveryCode `json:"recovery_code"`
}

func (r *VerifyRecoveryCodeRequest) Normalize() {}

func (r VerifyRecoveryCodeRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !common.IsOpaqueToken(string(r.LoginChallengeToken)) {
		fields = append(fields, "login_challenge_token")
	}
	if !common.IsTOTPRecoveryCode(r.RecoveryCode) {
		fields = append(fields, "recovery_code")
	}
	return fields
}

type VerifyRecoveryCodeResponse struct {
	AuthenticatedSessionResponse
	RemainingRecoveryCodes common.TOTPRecoveryCodeCount `json:"remaining_recovery_codes"`
}

type RegenerateTOTPRecoveryCodesResponse struct {
	RecoveryCodes []common.TOTPRecoveryCode `json:"recovery_codes"`
}
