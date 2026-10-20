import type { Details } from "../details.ts";

export const ListingPlanRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-plan-required",
  title: "Org Listing plan required",
  status: 403,
  detail: "The Org's plan does not allow marketplace Listings",
};

export const ListingNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-not-found",
  title: "Org Listing not found",
  status: 404,
  detail: "No Listing is readable for the requested provider and Capability",
};

export const ListingExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-exists",
  title: "Org Listing exists",
  status: 409,
  detail: "The Org already has a Listing for this Capability",
};

export const ListingVersionConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-version-conflict",
  title: "Org Listing version conflict",
  status: 409,
  detail: "The Listing changed since it was read",
};

export const ListingStateConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-state-conflict",
  title: "Org Listing state conflict",
  status: 409,
  detail: "The Listing's state does not allow this action",
};

export const TenantUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/org-tenant-unavailable",
  title: "Org tenant unavailable",
  status: 503,
  detail: "The tenant that holds the requested data did not answer in time",
};
