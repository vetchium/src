// Package hub contains RFC 9457 problems owned by the Hub API.
package hub

import "github.com/vetchium/src/typespec/problem"

var InvalidCredentialsError = problem.Details{
	Type:   "vetchium-problem-details/hub-invalid-credentials",
	Title:  "Invalid Hub credentials",
	Status: 401,
	Detail: "The supplied credentials are invalid",
}

var IncorrectPasswordError = problem.Details{
	Type:   "vetchium-problem-details/hub-incorrect-password",
	Title:  "Incorrect password",
	Status: 422,
	Detail: "The password did not verify for the authenticated Hub user",
}

var HubUserDisabledError = problem.Details{
	Type:   "vetchium-problem-details/hub-user-disabled",
	Title:  "Hub user disabled",
	Status: 403,
	Detail: "The Hub user is disabled",
}

var AuthenticationRequiredError = problem.Details{
	Type:   "vetchium-problem-details/hub-authentication-required",
	Title:  "Hub authentication required",
	Status: 401,
	Detail: "A valid Hub bearer session is required",
}

var RecentAuthenticationRequiredError = problem.Details{
	Type:   "vetchium-problem-details/hub-recent-authentication-required",
	Title:  "Recent authentication required",
	Status: 401,
	Detail: "Full authentication must have completed within the preceding " +
		"five minutes",
}

var InvalidLoginChallengeError = problem.Details{
	Type:   "vetchium-problem-details/hub-invalid-login-challenge",
	Title:  "Invalid Hub login challenge",
	Status: 401,
	Detail: "Login challenge is invalid, expired, or consumed",
}

var IncorrectTOTPCodeError = problem.Details{
	Type:   "vetchium-problem-details/hub-incorrect-totp-code",
	Title:  "Incorrect TOTP code",
	Status: 422,
	Detail: "The TOTP code did not verify",
}

var InvalidPasswordResetTokenError = problem.Details{
	Type:   "vetchium-problem-details/hub-invalid-password-reset-token",
	Title:  "Invalid password reset token",
	Status: 401,
	Detail: "Password reset token is invalid, expired, consumed, or no " +
		"longer eligible",
}
