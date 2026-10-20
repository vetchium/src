package orgs

import "github.com/vetchium/src/typespec/problem"

var ListingPlanRequiredError = problem.Details{
	Type:   "vetchium-problem-details/org-listing-plan-required",
	Title:  "Org Listing plan required",
	Status: 403,
	Detail: "The Org's plan does not allow marketplace Listings",
}

var ListingNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-listing-not-found",
	Title:  "Org Listing not found",
	Status: 404,
	Detail: "No Listing is readable for the requested provider and Capability",
}

var ListingExistsError = problem.Details{
	Type:   "vetchium-problem-details/org-listing-exists",
	Title:  "Org Listing exists",
	Status: 409,
	Detail: "The Org already has a Listing for this Capability",
}

var ListingVersionConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-listing-version-conflict",
	Title:  "Org Listing version conflict",
	Status: 409,
	Detail: "The Listing changed since it was read",
}

var ListingStateConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-listing-state-conflict",
	Title:  "Org Listing state conflict",
	Status: 409,
	Detail: "The Listing's state does not allow this action",
}

var TenantUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/org-tenant-unavailable",
	Title:  "Org tenant unavailable",
	Status: 503,
	Detail: "The tenant that holds the requested data did not answer in time",
}

var ListingNotAvailableError = problem.Details{
	Type:   "vetchium-problem-details/org-listing-not-available",
	Title:  "Org Listing not available",
	Status: 409,
	Detail: "The Listing is not listed or its provider cannot take engagements",
}

var EngagementExistsError = problem.Details{
	Type:   "vetchium-problem-details/org-engagement-exists",
	Title:  "Org engagement exists",
	Status: 409,
	Detail: "A non-terminal engagement exists for the provider and Capability",
}

var EngagementSelfError = problem.Details{
	Type:   "vetchium-problem-details/org-engagement-self",
	Title:  "Org engagement with itself",
	Status: 422,
	Detail: "An Org cannot engage itself",
}

var EngagementNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-engagement-not-found",
	Title:  "Org engagement not found",
	Status: 404,
	Detail: "No engagement with the requested id involves the Org",
}

var EngagementStateConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-engagement-state-conflict",
	Title:  "Org engagement state conflict",
	Status: 409,
	Detail: "The engagement's state does not allow this action",
}

var EngagementVersionConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-engagement-version-conflict",
	Title:  "Org engagement version conflict",
	Status: 409,
	Detail: "The engagement changed since it was read",
}

var AssignmentExistsError = problem.Details{
	Type:   "vetchium-problem-details/org-assignment-exists",
	Title:  "Org assignment exists",
	Status: 409,
	Detail: "The engagement is already assigned there",
}

var AssignmentNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-assignment-not-found",
	Title:  "Org assignment not found",
	Status: 404,
	Detail: "The engagement is not assigned there",
}

type AssignmentLimitReachedDetails struct {
	problem.Details
	Limit int32 `json:"limit"`
}

func AssignmentLimitReachedError(limit int32) AssignmentLimitReachedDetails {
	return AssignmentLimitReachedDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-assignment-limit-reached",
			Title:  "Org assignment limit reached",
			Status: 409,
			Detail: "No more engagements may be assigned there",
		},
		Limit: limit,
	}
}

var EngagementCapabilityMismatchError = problem.Details{
	Type:   "vetchium-problem-details/org-engagement-capability-mismatch",
	Title:  "Org engagement Capability mismatch",
	Status: 422,
	Detail: "The engagement's Capability does not perform the stage kind",
}
