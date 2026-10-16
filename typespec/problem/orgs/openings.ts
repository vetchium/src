import type { Details } from "../details.ts";

export const OpeningNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-opening-not-found",
  title: "Org Opening not found",
  status: 404,
  detail: "No readable Opening has the requested number",
};

export const OpeningVersionConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-opening-version-conflict",
  title: "Org Opening version conflict",
  status: 409,
  detail: "The Opening changed since it was read",
};

export const OpeningRequestPendingError: Readonly<Details> = {
  type: "vetchium-problem-details/org-opening-request-pending",
  title: "Org Opening request pending",
  status: 409,
  detail: "Another request is pending for this Opening",
};

export const OpeningStateConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-opening-state-conflict",
  title: "Org Opening state conflict",
  status: 409,
  detail: "The action is not allowed in the Opening's current state",
};

export interface OpeningIncompleteDetails extends Details {
  type: "vetchium-problem-details/org-opening-incomplete";
  fields: string[];
}

export interface OpeningHiringTeamInvalidDetails extends Details {
  type: "vetchium-problem-details/org-opening-hiring-team-invalid";
  email_addresses: string[];
}

export interface OpeningsQuotaExceededDetails extends Details {
  type: "vetchium-problem-details/org-openings-quota-exceeded";
  quota: number;
  count: number;
}
