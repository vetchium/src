package hub

import "github.com/vetchium/src/typespec/problem"

var SignupDomainNotAllowedError = problem.Details{
	Type:   "vetchium-problem-details/hub-signup-domain-not-allowed",
	Title:  "Hub signup domain not allowed",
	Status: 403,
	Detail: "This tenant does not allow Hub signup with that email domain",
}

var InvalidSignupTokenError = problem.Details{
	Type:   "vetchium-problem-details/hub-invalid-signup-token",
	Title:  "Invalid Hub signup token",
	Status: 401,
	Detail: "Signup token is invalid, expired, consumed, or no longer eligible",
}
