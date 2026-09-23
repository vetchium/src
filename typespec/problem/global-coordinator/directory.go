package globalcoordinator

import "github.com/vetchium/src/typespec/problem"

var DirectoryAuthenticationRequiredError = problem.Details{
	Type:  "vetchium-problem-details/directory-authentication-required",
	Title: "Directory authentication required", Status: 401,
	Detail: "A private-CA verified tenant client certificate is required",
}

var DirectoryEntryNotFoundError = problem.Details{
	Type: "vetchium-problem-details/directory-entry-not-found", Title: "Directory entry not found",
	Status: 404, Detail: "The requested global directory entry does not exist",
}
var DirectoryClaimConflictError = problem.Details{
	Type: "vetchium-problem-details/directory-claim-conflict", Title: "Directory claim conflict",
	Status: 409, Detail: "The requested global identity or profile slug is already claimed",
}
var DirectoryStateConflictError = problem.Details{
	Type: "vetchium-problem-details/directory-state-conflict", Title: "Directory state conflict",
	Status: 409, Detail: "The global identity is not in the required lifecycle state",
}
var DirectoryCallerTenantMismatchError = problem.Details{
	Type:  "vetchium-problem-details/directory-caller-tenant-mismatch",
	Title: "Directory caller tenant mismatch", Status: 403,
	Detail: "The authenticated tenant does not own the requested global identity operation",
}
