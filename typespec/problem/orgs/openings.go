package orgs

import "github.com/vetchium/src/typespec/problem"

var OpeningNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-opening-not-found",
	Title:  "Org Opening not found",
	Status: 404,
	Detail: "No readable Opening has the requested number",
}

var OpeningVersionConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-opening-version-conflict",
	Title:  "Org Opening version conflict",
	Status: 409,
	Detail: "The Opening changed since it was read",
}

var OpeningRequestPendingError = problem.Details{
	Type:   "vetchium-problem-details/org-opening-request-pending",
	Title:  "Org Opening request pending",
	Status: 409,
	Detail: "Another request is pending for this Opening",
}

var OpeningStateConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-opening-state-conflict",
	Title:  "Org Opening state conflict",
	Status: 409,
	Detail: "The action is not allowed in the Opening's current state",
}

func OpeningIncompleteError(fields []string) problem.Details {
	return problem.Details{
		Type:   "vetchium-problem-details/org-opening-incomplete",
		Title:  "Org Opening incomplete",
		Status: 422,
		Detail: "The Opening is incomplete for publication",
		Fields: fields,
	}
}

type OpeningHiringTeamInvalidDetails struct {
	problem.Details
	EmailAddresses []string `json:"email_addresses"`
}

func OpeningHiringTeamInvalidError(addresses []string) OpeningHiringTeamInvalidDetails {
	return OpeningHiringTeamInvalidDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-opening-hiring-team-invalid",
			Title:  "Org Opening hiring team invalid",
			Status: 422,
			Detail: "A named hiring-team user is unavailable",
		},
		EmailAddresses: addresses,
	}
}

type OpeningsQuotaExceededDetails struct {
	problem.Details
	Quota int32 `json:"quota"`
	Count int32 `json:"count"`
}

func OpeningsQuotaExceededError(quota, count int32) OpeningsQuotaExceededDetails {
	return OpeningsQuotaExceededDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-openings-quota-exceeded",
			Title:  "Org Openings quota exceeded",
			Status: 409,
			Detail: "The Org has no free Opening slot under its plan",
		},
		Quota: quota,
		Count: count,
	}
}
