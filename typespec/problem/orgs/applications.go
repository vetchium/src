package orgs

import "github.com/vetchium/src/typespec/problem"

var ApplicationNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-application-not-found",
	Title:  "Org application not found",
	Status: 404,
	Detail: "No readable application has the requested number",
}

var ApplicationVersionConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-application-version-conflict",
	Title:  "Org application version conflict",
	Status: 409,
	Detail: "The application changed since it was read",
}

var ApplicationStateConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-application-state-conflict",
	Title:  "Org application state conflict",
	Status: 409,
	Detail: "The action is not allowed in the application's current state",
}

var OfferLetterTooLargeError = problem.Details{
	Type:   "vetchium-problem-details/org-offer-letter-too-large",
	Title:  "Org offer letter too large",
	Status: 413,
	Detail: "The offer letter exceeds the five-mebibyte limit",
}

var OfferLetterInvalidError = problem.Details{
	Type:   "vetchium-problem-details/org-offer-letter-invalid",
	Title:  "Invalid Org offer letter",
	Status: 400,
	Detail: "The offer letter is not a PDF",
}

var OfferLetterConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-offer-letter-conflict",
	Title:  "Org offer letter conflict",
	Status: 409,
	Detail: "The upload was superseded or expired before it completed",
}
