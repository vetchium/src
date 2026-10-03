package orgs

import "github.com/vetchium/src/typespec/problem"

var SSOSignInFailedError = problem.Details{
	Type:   "vetchium-problem-details/org-sso-sign-in-failed",
	Title:  "Sign-in failed",
	Status: 401,
	Detail: "The sign-in could not be completed",
}

var SSONotAvailableError = problem.Details{
	Type:   "vetchium-problem-details/org-sso-not-available",
	Title:  "Single sign-on not available",
	Status: 404,
	Detail: "Google sign-in is not available in this region",
}
