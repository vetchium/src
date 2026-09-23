import type { Details } from "../details.ts";

export const directoryAuthenticationRequiredError = {
  type: "vetchium-problem-details/directory-authentication-required",
  title: "Directory authentication required",
  status: 401,
  detail: "A private-CA verified tenant client certificate is required",
} as const satisfies Details;
export const directoryEntryNotFoundError = {
  type: "vetchium-problem-details/directory-entry-not-found",
  title: "Directory entry not found",
  status: 404,
  detail: "The requested global directory entry does not exist",
} as const satisfies Details;
export const directoryClaimConflictError = {
  type: "vetchium-problem-details/directory-claim-conflict",
  title: "Directory claim conflict",
  status: 409,
  detail: "The requested global identity or profile slug is already claimed",
} as const satisfies Details;
export const directoryStateConflictError = {
  type: "vetchium-problem-details/directory-state-conflict",
  title: "Directory state conflict",
  status: 409,
  detail: "The global identity is not in the required lifecycle state",
} as const satisfies Details;
export const directoryCallerTenantMismatchError = {
  type: "vetchium-problem-details/directory-caller-tenant-mismatch",
  title: "Directory caller tenant mismatch",
  status: 403,
  detail:
    "The authenticated tenant does not own the requested global identity operation",
} as const satisfies Details;
