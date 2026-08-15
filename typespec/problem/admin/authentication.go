// Package admin contains RFC 9457 problems owned by the Admin API.
package admin

import "github.com/vetchium/src/typespec/problem"

var InvalidCredentialsError = problem.Details{
	Type:   "vetchium-problem-details/invalid-credentials",
	Title:  "Invalid credentials",
	Status: 401,
	Detail: "The supplied credentials are invalid",
}

var IncorrectPasswordError = problem.Details{
	Type:   "vetchium-problem-details/incorrect-password",
	Title:  "Incorrect password",
	Status: 422,
	Detail: "The password did not verify for the authenticated admin user",
}

var AdminUserDisabledError = problem.Details{
	Type:   "vetchium-problem-details/admin-user-disabled",
	Title:  "Admin user disabled",
	Status: 403,
	Detail: "The authenticated admin user is disabled",
}

var AdminAuthenticationRequiredError = problem.Details{
	Type:   "vetchium-problem-details/admin-authentication-required",
	Title:  "Admin authentication required",
	Status: 401,
	Detail: "A valid admin bearer session is required",
}

var RecentAuthenticationRequiredError = problem.Details{
	Type:   "vetchium-problem-details/recent-authentication-required",
	Title:  "Recent authentication required",
	Status: 401,
	Detail: "Full authentication must have completed within the preceding " +
		"five minutes",
}

var InvalidLoginChallengeError = problem.Details{
	Type:   "vetchium-problem-details/invalid-login-challenge",
	Title:  "Invalid login challenge",
	Status: 401,
	Detail: "Login challenge is invalid, expired, or consumed",
}

var IncorrectTOTPCodeError = problem.Details{
	Type:   "vetchium-problem-details/incorrect-totp-code",
	Title:  "Incorrect TOTP code",
	Status: 422,
	Detail: "The TOTP code did not verify",
}

var InvalidInvitationTokenError = problem.Details{
	Type:   "vetchium-problem-details/invalid-invitation-token",
	Title:  "Invalid invitation token",
	Status: 401,
	Detail: "Invitation token is invalid, expired, or consumed",
}

var InvalidPasswordResetTokenError = problem.Details{
	Type:   "vetchium-problem-details/invalid-password-reset-token",
	Title:  "Invalid password reset token",
	Status: 401,
	Detail: "Password reset token is invalid, expired, consumed, or no " +
		"longer eligible",
}
