import {
  type BillingInterval,
  type HubPlan,
  type HubPlanOID,
  isBillingInterval,
  isHubPlan,
  requiresBillingInterval,
} from "./plans.ts";

export interface ScheduledPlanChange {
  plan_oid: HubPlanOID;
  /** Absent when the scheduled plan is `hub-free-tier`. */
  billing_interval?: BillingInterval;
}

export interface HubSubscription {
  plan_oid: HubPlanOID;
  /** Present exactly when the plan is paid. */
  billing_interval?: BillingInterval;
  current_period_start?: string;
  current_period_end?: string;
  cancel_at_period_end: boolean;
  scheduled_change?: ScheduledPlanChange;
}

export interface SetSubscriptionPlanRequest {
  plan_oid: HubPlan;
  /** Absent for `hub-free-tier`; required otherwise. Never null. */
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
  const validPlan = typeof planOID === "string" && isHubPlan(planOID);
  if (!validPlan) {
    fields.push("plan_oid");
  }
  const billingValue = record.billing_interval;
  const present = billingValue !== undefined;
  if (billingValue === null) {
    fields.push("billing_interval");
  } else if (present && !isBillingInterval(billingValue)) {
    fields.push("billing_interval");
  } else if (
    validPlan &&
    requiresBillingInterval(planOID as HubPlan) !== present
  ) {
    fields.push("billing_interval");
  }
  return fields;
}
