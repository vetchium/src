export const hubPlanValues = ["hub-free-tier", "hub-silver-tier"] as const;

export type HubPlan = (typeof hubPlanValues)[number];
export type HubPlanOID = string;

export const FreeTier: HubPlan = "hub-free-tier";
export const SilverTier: HubPlan = "hub-silver-tier";

/** Both the signup plan and the downgrade target. */
export const DefaultPlan: HubPlan = FreeTier;

/** Ordered by ascending rank, the way portals present plans. */
export const plans: readonly HubPlan[] = [FreeTier, SilverTier];

const planRanks: Readonly<Record<HubPlan, number>> = {
  "hub-free-tier": 1000,
  "hub-silver-tier": 2000,
};

const hubPlans = new Set<string>(hubPlanValues);

export function isHubPlan(value: unknown): value is HubPlan {
  return typeof value === "string" && hubPlans.has(value);
}

export const billingIntervalValues = ["month", "year"] as const;

export type BillingInterval = (typeof billingIntervalValues)[number];

const billingIntervals = new Set<string>(billingIntervalValues);

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && billingIntervals.has(value);
}

/** Returns 0 for a plan this contract version does not define. */
export function planRank(plan: HubPlanOID): number {
  return isHubPlan(plan) ? planRanks[plan] : 0;
}

export function plansAtOrAbove(minimum: HubPlan): readonly HubPlan[] {
  return plans.filter((plan) => planRank(plan) >= planRank(minimum));
}

/**
 * Reports whether the plan held is at or above required. An unknown held plan
 * never includes anything.
 */
export function planIncludes(held: HubPlanOID, required: HubPlan): boolean {
  if (!isHubPlan(held)) return false;
  return planRank(held) >= planRank(required);
}

export function requiresBillingInterval(plan: HubPlan): boolean {
  return plan !== FreeTier;
}

/**
 * The single statement of the upgrade rule: a higher plan rank, or the same
 * plan moving from a monthly to an annual interval. An empty interval stands
 * for the free plan, which has none.
 */
export function isUpgrade(
  fromPlan: HubPlan,
  fromInterval: BillingInterval | undefined,
  toPlan: HubPlan,
  toInterval: BillingInterval | undefined,
): boolean {
  if (planRank(toPlan) !== planRank(fromPlan)) {
    return planRank(toPlan) > planRank(fromPlan);
  }
  return fromInterval === "month" && toInterval === "year";
}
