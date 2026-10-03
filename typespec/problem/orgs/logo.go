package orgs

import "github.com/vetchium/src/typespec/problem"

var LogoTooLargeError = problem.Details{
	Type:   "vetchium-problem-details/org-logo-too-large",
	Title:  "Org logo too large",
	Status: 413,
	Detail: "The logo exceeds the two-mebibyte limit",
}

var LogoInvalidError = problem.Details{
	Type:   "vetchium-problem-details/org-logo-invalid",
	Title:  "Invalid Org logo",
	Status: 400,
	Detail: "The image format or dimensions are not supported",
}

var LogoConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-logo-conflict",
	Title:  "Org logo conflict",
	Status: 409,
	Detail: "The logo change conflicts with the current state",
}
