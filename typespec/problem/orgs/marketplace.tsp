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

const OrgListingNotAvailableError = #{
  type: "vetchium-problem-details/org-listing-not-available",
  title: "Org Listing not available",
  status: 409,
  detail: "The Listing is not listed or its provider cannot take engagements",
};
alias OrgListingNotAvailableErrorResponse = Response<
  409,
  typeof OrgListingNotAvailableError
>;

const OrgEngagementExistsError = #{
  type: "vetchium-problem-details/org-engagement-exists",
  title: "Org engagement exists",
  status: 409,
  detail: "A non-terminal engagement exists for the provider and Capability",
};
alias OrgEngagementExistsErrorResponse = Response<
  409,
  typeof OrgEngagementExistsError
>;

const OrgEngagementSelfError = #{
  type: "vetchium-problem-details/org-engagement-self",
  title: "Org engagement with itself",
  status: 422,
  detail: "An Org cannot engage itself",
};
alias OrgEngagementSelfErrorResponse = Response<
  422,
  typeof OrgEngagementSelfError
>;

const OrgEngagementNotFoundError = #{
  type: "vetchium-problem-details/org-engagement-not-found",
  title: "Org engagement not found",
  status: 404,
  detail: "No engagement with the requested id involves the Org",
};
alias OrgEngagementNotFoundErrorResponse = Response<
  404,
  typeof OrgEngagementNotFoundError
>;

const OrgEngagementStateConflictError = #{
  type: "vetchium-problem-details/org-engagement-state-conflict",
  title: "Org engagement state conflict",
  status: 409,
  detail: "The engagement's state does not allow this action",
};
alias OrgEngagementStateConflictErrorResponse = Response<
  409,
  typeof OrgEngagementStateConflictError
>;

const OrgEngagementVersionConflictError = #{
  type: "vetchium-problem-details/org-engagement-version-conflict",
  title: "Org engagement version conflict",
  status: 409,
  detail: "The engagement changed since it was read",
};
alias OrgEngagementVersionConflictErrorResponse = Response<
  409,
  typeof OrgEngagementVersionConflictError
>;
