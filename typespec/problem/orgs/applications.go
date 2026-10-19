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
