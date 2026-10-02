package orgs

import "github.com/vetchium/src/typespec/problem"

var OrgSuspendedError = problem.Details{
	Type:   "vetchium-problem-details/org-suspended",
	Title:  "Org suspended",
	Status: 403,
	Detail: "The Org is suspended and may only use billing and account operations",
}
