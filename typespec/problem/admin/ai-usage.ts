import type { Details } from "../details.ts";

export const OrgNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/admin-org-not-found",
  title: "Org not found",
  status: 404,
  detail: "No Org of this tenant holds that domain",
};

export const AIUsageNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/admin-ai-usage-not-found",
  title: "AI usage not found",
  status: 404,
  detail: "The Org has no kept AI usage text with that identifier",
};
