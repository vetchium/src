package globalcoordinator

import "github.com/vetchium/src/typespec/problem"

var AuthenticationRequiredError = problem.Details{
	Type: "vetchium-problem-details/" +
		"global-coordinator-authentication-required",
	Title:  "Global coordinator authentication required",
	Status: 401,
	Detail: "A private-CA verified tenant mesh client certificate is required",
}

var MeshRelayAuthenticationRequiredError = problem.Details{
	Type:  "vetchium-problem-details/mesh-relay-authentication-required",
	Title: "Mesh relay authentication required", Status: 401,
	Detail: "A valid tenant-local mesh relay credential is required",
}
