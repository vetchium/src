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

export const ListingNotAvailableError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-not-available",
  title: "Org Listing not available",
  status: 409,
  detail: "The Listing is not listed or its provider cannot take engagements",
};

export const EngagementExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-exists",
  title: "Org engagement exists",
  status: 409,
  detail: "A non-terminal engagement exists for the provider and Capability",
};

export const EngagementSelfError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-self",
  title: "Org engagement with itself",
  status: 422,
  detail: "An Org cannot engage itself",
};

export const EngagementNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-not-found",
  title: "Org engagement not found",
  status: 404,
  detail: "No engagement with the requested id involves the Org",
};

export const EngagementStateConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-state-conflict",
  title: "Org engagement state conflict",
  status: 409,
  detail: "The engagement's state does not allow this action",
};

export const EngagementVersionConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-version-conflict",
  title: "Org engagement version conflict",
  status: 409,
  detail: "The engagement changed since it was read",
};

export const AssignmentExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/org-assignment-exists",
  title: "Org assignment exists",
  status: 409,
  detail: "The engagement is already assigned there",
};

export const AssignmentNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-assignment-not-found",
  title: "Org assignment not found",
  status: 404,
  detail: "The engagement is not assigned there",
};

export interface AssignmentLimitReachedDetails extends Details {
  type: "vetchium-problem-details/org-assignment-limit-reached";
  limit: number;
}

export const EngagementCapabilityMismatchError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-capability-mismatch",
  title: "Org engagement Capability mismatch",
  status: 422,
  detail: "The engagement's Capability does not perform the stage kind",
};
