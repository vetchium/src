package globalcoordinator

import "github.com/vetchium/src/typespec/problem"

var AuthenticationRequiredError = problem.Details{
	Type: "vetchium-problem-details/" +
		"global-coordinator-authentication-required",
	Title:  "Global coordinator authentication required",
	Status: 401,
	Detail: "A valid global coordinator bearer credential is required",
}
