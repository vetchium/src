import type { HubPlanOID } from "../../hub/subscriptions/plans.ts";
import type { Details } from "../details.ts";

export const PlanNotOfferedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-plan-not-offered",
  title: "Hub plan not offered",
  status: 403,
  detail: "This tenant does not offer that Hub plan",
};

export interface PlanRequiredDetails extends Details {
  type: "vetchium-problem-details/hub-plan-required";
  required_plan_oid: HubPlanOID;
}

export const PlanRequiredErrorType =
  "vetchium-problem-details/hub-plan-required";

export function isPlanRequiredProblem(
  value: unknown,
): value is PlanRequiredDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type: unknown }).type === PlanRequiredErrorType &&
    "required_plan_oid" in value &&
    typeof (value as { required_plan_oid: unknown }).required_plan_oid ===
      "string"
  );
}
