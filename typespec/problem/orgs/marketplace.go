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
