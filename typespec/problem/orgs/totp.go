package orgs

import "github.com/vetchium/src/typespec/problem"

var TOTPAlreadyEnabledError = problem.Details{
	Type:   "vetchium-problem-details/org-totp-already-enabled",
	Title:  "TOTP already enabled",
	Status: 409,
	Detail: "The Org user already has confirmed TOTP",
}

var InvalidTOTPEnrollmentError = problem.Details{
	Type:   "vetchium-problem-details/org-invalid-totp-enrollment",
	Title:  "Invalid TOTP enrollment",
	Status: 409,
	Detail: "TOTP enrollment is invalid, expired, consumed, or belongs to another user",
}

var IncorrectRecoveryCodeError = problem.Details{
	Type:   "vetchium-problem-details/org-incorrect-recovery-code",
	Title:  "Incorrect recovery code",
	Status: 422,
	Detail: "The recovery code is incorrect, consumed, or unavailable",
}

var TOTPNotEnabledError = problem.Details{
	Type:   "vetchium-problem-details/org-totp-not-enabled",
	Title:  "TOTP not enabled",
	Status: 409,
	Detail: "The Org user does not have confirmed TOTP",
}
