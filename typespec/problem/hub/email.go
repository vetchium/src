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
