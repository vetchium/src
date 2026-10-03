import {
  type BillingInterval,
  isBillingInterval,
  isOrgPlan,
  type OrgPlan,
  type OrgPlanOID,
  requiresBillingInterval,
} from "./plans.ts";

export interface OrgSubscription {
  plan_oid: OrgPlanOID;
  /** Absent on Free. */
  billing_interval?: BillingInterval;
  seats_in_use: number;
  /** Absent when uncapped. */
  seat_limit?: number;
}

export interface SetSubscriptionPlanRequest {
  plan_oid: OrgPlan;
  /** Absent for `org-free-tier`; required otherwise. Never null. */
  billing_interval?: BillingInterval;
}

/**
 * Applies the same rules as the Go companion's Validate() to an untrusted
 * value, including an explicit `billing_interval: null`. Returns the invalid
 * JSON field names.
 */
export function validateSetSubscriptionPlanRequest(value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return ["plan_oid", "billing_interval"];
  }
  const record = value as Record<string, unknown>;
  const fields: string[] = [];
  const planOID = record.plan_oid;
  const validPlan = typeof planOID === "string" && isOrgPlan(planOID);
  if (!validPlan) fields.push("plan_oid");
  const billingValue = record.billing_interval;
  const present = billingValue !== undefined;
  if (billingValue === null) {
    fields.push("billing_interval");
  } else if (present && !isBillingInterval(billingValue)) {
    fields.push("billing_interval");
  } else if (
    validPlan &&
    requiresBillingInterval(planOID as OrgPlan) !== present
  ) {
    fields.push("billing_interval");
  }
  return fields;
}
