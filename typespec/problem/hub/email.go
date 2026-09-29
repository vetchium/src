package hub

import "github.com/vetchium/src/typespec/problem"

var EmailChangeCodeRejectedError = problem.Details{
	Type:   "vetchium-problem-details/hub-email-change-code-rejected",
	Title:  "Email change code rejected",
	Status: 400,
	Detail: "The email change code could not be accepted",
}

var EmailAddressUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/hub-email-address-unavailable",
	Title:  "Email address unavailable",
	Status: 409,
	Detail: "Another Hub account already uses that email address",
}

var EmailChangeInProgressError = problem.Details{
	Type:   "vetchium-problem-details/hub-email-change-in-progress",
	Title:  "Email change in progress",
	Status: 409,
	Detail: "Another email change is already in progress for this account",
}

// EmailChangeUnavailableError reports that the global reservation lapsed
// before the change could be applied, most likely from a sustained
// coordinator outage. Retryable: request a new code and confirm again.
var EmailChangeUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/hub-email-change-unavailable",
	Title:  "Email change unavailable",
	Status: 503,
	Detail: "The email change could not be completed and must be retried",
}
