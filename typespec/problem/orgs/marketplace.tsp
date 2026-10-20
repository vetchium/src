import "../details.tsp";

namespace Vetchium.Problem;

const OrgListingPlanRequiredError = #{
  type: "vetchium-problem-details/org-listing-plan-required",
  title: "Org Listing plan required",
  status: 403,
  detail: "The Org's plan does not allow marketplace Listings",
};
alias OrgListingPlanRequiredErrorResponse = Response<
  403,
  typeof OrgListingPlanRequiredError
>;

const OrgListingNotFoundError = #{
  type: "vetchium-problem-details/org-listing-not-found",
  title: "Org Listing not found",
  status: 404,
  detail: "No Listing is readable for the requested provider and Capability",
};
alias OrgListingNotFoundErrorResponse = Response<
  404,
  typeof OrgListingNotFoundError
>;

const OrgListingExistsError = #{
  type: "vetchium-problem-details/org-listing-exists",
  title: "Org Listing exists",
  status: 409,
  detail: "The Org already has a Listing for this Capability",
};
alias OrgListingExistsErrorResponse = Response<
  409,
  typeof OrgListingExistsError
>;

const OrgListingVersionConflictError = #{
  type: "vetchium-problem-details/org-listing-version-conflict",
  title: "Org Listing version conflict",
  status: 409,
  detail: "The Listing changed since it was read",
};
alias OrgListingVersionConflictErrorResponse = Response<
  409,
  typeof OrgListingVersionConflictError
>;

const OrgListingStateConflictError = #{
  type: "vetchium-problem-details/org-listing-state-conflict",
  title: "Org Listing state conflict",
  status: 409,
  detail: "The Listing's state does not allow this action",
};
alias OrgListingStateConflictErrorResponse = Response<
  409,
  typeof OrgListingStateConflictError
>;

const OrgTenantUnavailableError = #{
  type: "vetchium-problem-details/org-tenant-unavailable",
  title: "Org tenant unavailable",
  status: 503,
  detail: "The tenant that holds the requested data did not answer in time",
};
alias OrgTenantUnavailableErrorResponse = Response<
  503,
  typeof OrgTenantUnavailableError
>;
