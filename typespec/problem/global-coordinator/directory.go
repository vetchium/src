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
var DirectoryEmailClaimConflictError = problem.Details{
	Type:  "vetchium-problem-details/directory-email-claim-conflict",
	Title: "Directory email claim conflict", Status: 409,
	Detail: "The email digest is already claimed by another Hub user",
}
var DirectoryDigestKeyMismatchError = problem.Details{
	Type:  "vetchium-problem-details/directory-digest-key-mismatch",
	Title: "Directory digest key mismatch", Status: 409,
	Detail: "The caller's identity digest key id does not match the configured key",
}
var DirectoryReservationExpiredError = problem.Details{
	Type:  "vetchium-problem-details/directory-reservation-expired",
	Title: "Directory reservation expired", Status: 409,
	Detail: "The email change reservation arrived after its deadline",
}
var DirectoryReservationCancelledError = problem.Details{
	Type:  "vetchium-problem-details/directory-reservation-cancelled",
	Title: "Directory reservation cancelled", Status: 409,
	Detail: "The email change reservation was already abandoned",
}
