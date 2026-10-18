package orgs

import "github.com/vetchium/src/typespec/problem"

var ApplicationNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-application-not-found",
	Title:  "Org application not found",
	Status: 404,
	Detail: "No readable application has the requested number",
}
