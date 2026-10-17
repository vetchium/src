package admin

import "github.com/vetchium/src/typespec/problem"

var OrgNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/admin-org-not-found",
	Title:  "Org not found",
	Status: 404,
	Detail: "No Org of this tenant holds that domain",
}

var AIUsageNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/admin-ai-usage-not-found",
	Title:  "AI usage not found",
	Status: 404,
	Detail: "The Org has no kept AI usage text with that identifier",
}
