import type { Details } from "../details.ts";

export const OrgSuspendedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-suspended",
  title: "Org suspended",
  status: 403,
  detail:
    "The Org is suspended and may only use billing and account operations",
};
