package admin

import "github.com/vetchium/src/typespec/problem"

var TOTPAlreadyEnabledError = problem.Details{
	Type:   "vetchium-problem-details/totp-already-enabled",
	Title:  "TOTP already enabled",
	Status: 409,
	Detail: "The admin user already has confirmed TOTP",
}

var InvalidTOTPEnrollmentError = problem.Details{
	Type:   "vetchium-problem-details/invalid-totp-enrollment",
	Title:  "Invalid TOTP enrollment",
	Status: 409,
	Detail: "TOTP enrollment is invalid, expired, consumed, or belongs to " +
		"another user",
}

var IncorrectRecoveryCodeError = problem.Details{
	Type:   "vetchium-problem-details/incorrect-recovery-code",
	Title:  "Incorrect recovery code",
	Status: 422,
	Detail: "The recovery code is incorrect, consumed, or unavailable",
}

var TOTPNotEnabledError = problem.Details{
	Type:   "vetchium-problem-details/totp-not-enabled",
	Title:  "TOTP not enabled",
	Status: 409,
	Detail: "The admin user does not have confirmed TOTP",
}
