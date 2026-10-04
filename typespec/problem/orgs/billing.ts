import type { OrgPlanOID } from "../../orgs/subscriptions/plans.ts";
import type { Details } from "../details.ts";

export const PlanNotOfferedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-plan-not-offered",
  title: "Org plan not offered",
  status: 403,
  detail: "This tenant does not offer that Org plan",
};

export interface PlanRequiredDetails extends Details {
  type: "vetchium-problem-details/org-plan-required";
  plan_oid: OrgPlanOID;
}

export const PlanRequiredErrorType =
  "vetchium-problem-details/org-plan-required";

export function isPlanRequiredProblem(
  value: unknown,
): value is PlanRequiredDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === PlanRequiredErrorType &&
    typeof (value as { plan_oid?: unknown }).plan_oid === "string"
  );
}

export interface UserLimitExceedsTargetDetails extends Details {
  type: "vetchium-problem-details/org-user-limit-exceeds-target";
  limit: number;
  seats_in_use: number;
}

export const UserLimitExceedsTargetErrorType =
  "vetchium-problem-details/org-user-limit-exceeds-target";

export function isUserLimitExceedsTargetProblem(
  value: unknown,
): value is UserLimitExceedsTargetDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === UserLimitExceedsTargetErrorType &&
    typeof (value as { limit?: unknown }).limit === "number" &&
    typeof (value as { seats_in_use?: unknown }).seats_in_use === "number"
  );
}
