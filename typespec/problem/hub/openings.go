package hub

import "github.com/vetchium/src/typespec/problem"

var OrgNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-org-not-found",
	Title:  "Org not found",
	Status: 404,
	Detail: "The requested Org was not found",
}

var OpeningNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-opening-not-found",
	Title:  "Opening not found",
	Status: 404,
	Detail: "The requested Opening was not found",
}

var OrgUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/hub-org-unavailable",
	Title:  "Org unavailable",
	Status: 503,
	Detail: "The requested Org is temporarily unavailable",
}
