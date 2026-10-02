package orgs

import "github.com/vetchium/src/typespec/problem"

var InvalidCredentialsError = problem.Details{
	Type:   "vetchium-problem-details/org-invalid-credentials",
	Title:  "Invalid Org credentials",
	Status: 401,
	Detail: "The supplied credentials are invalid",
}

var IncorrectPasswordError = problem.Details{
	Type:   "vetchium-problem-details/org-incorrect-password",
	Title:  "Incorrect password",
	Status: 422,
	Detail: "The password did not verify for the authenticated Org user",
}

var OrgUserDisabledError = problem.Details{
	Type:   "vetchium-problem-details/org-user-disabled",
	Title:  "Org user disabled",
	Status: 403,
	Detail: "The Org user is disabled",
}

var AuthenticationRequiredError = problem.Details{
	Type:   "vetchium-problem-details/org-authentication-required",
	Title:  "Org authentication required",
	Status: 401,
	Detail: "A valid Org bearer session is required",
}

var InvalidLoginChallengeError = problem.Details{
	Type:   "vetchium-problem-details/org-invalid-login-challenge",
	Title:  "Invalid Org login challenge",
	Status: 401,
	Detail: "Login challenge is invalid, expired, or consumed",
}

var IncorrectTOTPCodeError = problem.Details{
	Type:   "vetchium-problem-details/org-incorrect-totp-code",
	Title:  "Incorrect TOTP code",
	Status: 422,
	Detail: "The TOTP code did not verify",
}

var InvalidPasswordResetTokenError = problem.Details{
	Type:   "vetchium-problem-details/org-invalid-password-reset-token",
	Title:  "Invalid password reset token",
	Status: 401,
	Detail: "Password reset token is invalid, expired, consumed, or no longer eligible",
}

var PermissionRequiredError = problem.Details{
	Type:   "vetchium-problem-details/org-permission-required",
	Title:  "Org permission required",
	Status: 403,
	Detail: "The Org user lacks the permission this operation requires",
}

var RecentAuthenticationRequiredError = problem.Details{
	Type:   "vetchium-problem-details/org-recent-authentication-required",
	Title:  "Recent authentication required",
	Status: 401,
	Detail: "Full authentication must have completed within the preceding five minutes",
}

// HomedElsewhereDetails is the Go companion of TypeSpec's
// OrgHomedElsewhereDetails.
type HomedElsewhereDetails struct {
	problem.Details
	TenantID string `json:"tenant_id"`
}

func HomedElsewhereError(tenantID string) HomedElsewhereDetails {
	return HomedElsewhereDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-homed-elsewhere",
			Title:  "Org homed in another region",
			Status: 409,
			Detail: "This Org signs in at another region",
		},
		TenantID: tenantID,
	}
}
