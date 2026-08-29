package admin

import "github.com/vetchium/src/typespec/problem"

var HubSignupDomainNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-signup-domain-not-found",
	Title:  "Hub signup domain not found",
	Status: 404,
	Detail: "The requested Hub signup domain does not exist",
}

var HubSignupDomainAlreadyExistsError = problem.Details{
	Type:   "vetchium-problem-details/hub-signup-domain-already-exists",
	Title:  "Hub signup domain already exists",
	Status: 409,
	Detail: "The normalized domain is already in the Hub signup allowlist",
}
