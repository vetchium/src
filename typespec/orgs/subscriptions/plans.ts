export const orgPlanValues = [
  "org-free-tier",
  "org-silver-tier",
  "org-gold-tier",
] as const;

export type OrgPlan = (typeof orgPlanValues)[number];
export type OrgPlanOID = string;

export const FreeTier: OrgPlan = "org-free-tier";
export const SilverTier: OrgPlan = "org-silver-tier";
export const GoldTier: OrgPlan = "org-gold-tier";

/** Both the signup plan and the downgrade target. */
export const DefaultPlan: OrgPlan = FreeTier;

/** Ordered by ascending rank, the way portals present plans. */
export const plans: readonly OrgPlan[] = [FreeTier, SilverTier, GoldTier];

const planRanks: Readonly<Record<OrgPlan, number>> = {
  "org-free-tier": 1000,
  "org-silver-tier": 2000,
  "org-gold-tier": 3000,
};

/**
 * What one plan allows.
 */
export interface Entitlements {
  maxUsers: number;
  openingsPerYear: number;
  allowsLogo: boolean;
  includesTicketSupport: boolean;
  /** Gates AI operations, the monthly credit grant, and credit purchases.
   * Credits bought earlier stay usable without it. */
  allowsAI: boolean;
  aiCreditsPerMonth: number;
  /** Gates publishing marketplace Listings and receiving engagement
   * proposals. */
  allowsListings: boolean;
}

export const entitlements: Readonly<Record<OrgPlan, Entitlements>> = {
  "org-free-tier": {
    maxUsers: 5,
    openingsPerYear: 25,
    allowsLogo: false,
    includesTicketSupport: false,
    allowsAI: false,
    aiCreditsPerMonth: 0,
    allowsListings: false,
  },
  "org-silver-tier": {
    maxUsers: 50,
    openingsPerYear: 250,
    allowsLogo: true,
    includesTicketSupport: false,
    allowsAI: false,
    aiCreditsPerMonth: 0,
    allowsListings: true,
  },
  "org-gold-tier": {
    maxUsers: 1000,
    openingsPerYear: 2500,
    allowsLogo: true,
    includesTicketSupport: true,
    allowsAI: true,
    aiCreditsPerMonth: 100000,
    allowsListings: true,
  },
};

const orgPlans = new Set<string>(orgPlanValues);

export function isOrgPlan(value: unknown): value is OrgPlan {
  return typeof value === "string" && orgPlans.has(value);
}

export const billingIntervalValues = ["month", "year"] as const;

export type BillingInterval = (typeof billingIntervalValues)[number];

const billingIntervals = new Set<string>(billingIntervalValues);

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && billingIntervals.has(value);
}

/** Returns 0 for a plan this contract version does not define. */
export function planRank(plan: OrgPlanOID): number {
  return isOrgPlan(plan) ? planRanks[plan] : 0;
}

export function plansAtOrAbove(minimum: OrgPlan): readonly OrgPlan[] {
  return plans.filter((plan) => planRank(plan) >= planRank(minimum));
}

/**
 * Reports whether the plan held is at or above required. An unknown held plan
 * never includes anything.
 */
export function planIncludes(held: OrgPlanOID, required: OrgPlan): boolean {
  if (!isOrgPlan(held)) return false;
  return planRank(held) >= planRank(required);
}

export function requiresBillingInterval(plan: OrgPlan): boolean {
  return plan !== FreeTier;
}

/**
 * The single statement of the upgrade rule: a higher plan rank, or the same
 * plan moving from a monthly to an annual interval. An empty interval stands
 * for the free plan, which has none.
 */
export function isUpgrade(
  fromPlan: OrgPlan,
  fromInterval: BillingInterval | undefined,
  toPlan: OrgPlan,
  toInterval: BillingInterval | undefined,
): boolean {
  if (planRank(toPlan) !== planRank(fromPlan)) {
    return planRank(toPlan) > planRank(fromPlan);
  }
  return fromInterval === "month" && toInterval === "year";
}

/** The seat cap; an unknown plan has a cap of zero. */
export function maxUsers(plan: OrgPlanOID): number {
  return isOrgPlan(plan) ? entitlements[plan].maxUsers : 0;
}

export function openingsPerYear(plan: OrgPlanOID): number {
  return isOrgPlan(plan) ? entitlements[plan].openingsPerYear : 0;
}

export function allowsLogo(plan: OrgPlanOID): boolean {
  return isOrgPlan(plan) && entitlements[plan].allowsLogo;
}

export function includesTicketSupport(plan: OrgPlanOID): boolean {
  return isOrgPlan(plan) && entitlements[plan].includesTicketSupport;
}

export function allowsAI(plan: OrgPlanOID): boolean {
  return isOrgPlan(plan) && entitlements[plan].allowsAI;
}

export function aiCreditsPerMonth(plan: OrgPlanOID): number {
  return isOrgPlan(plan) ? entitlements[plan].aiCreditsPerMonth : 0;
}

export function allowsListings(plan: OrgPlanOID): boolean {
  return isOrgPlan(plan) && entitlements[plan].allowsListings;
}
