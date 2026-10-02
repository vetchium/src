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

export const BillingPastDueError: Readonly<Details> = {
  type: "vetchium-problem-details/org-billing-past-due",
  title: "Org billing past due",
  status: 409,
  detail:
    "The plan cannot be changed while an invoice is unpaid. Pay the open invoice first.",
};

export const PaymentMethodRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/org-payment-method-required",
  title: "Org payment method required",
  status: 409,
  detail: "Save a payment method before this charge",
};

export const PaymentDeclinedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-payment-declined",
  title: "Org payment declined",
  status: 402,
  detail: "The saved payment method was declined. Nothing was changed.",
};

export const InvoiceNotOpenError: Readonly<Details> = {
  type: "vetchium-problem-details/org-invoice-not-open",
  title: "Org invoice not open",
  status: 409,
  detail: "The invoice is not open for payment",
};

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
