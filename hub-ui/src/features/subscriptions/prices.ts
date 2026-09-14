import type {
  BillingInterval,
  HubPlan,
} from "typespec/hub/subscriptions/plans";

interface PlanPrice {
  month: number;
  year: number;
}

interface TenantPrices {
  currency: string;
  plans: Partial<Record<HubPlan, PlanPrice>>;
}

/**
 * Hardcoded prices, keyed by tenant ID, plan, and billing interval. The
 * currency follows the account's home tenant, not the user's resident
 * country. Annual price is eleven months of the monthly price. `hub-free-tier`
 * has no entry: it has no price.
 */
export const prices = {
  usa1: {
    currency: "USD",
    plans: { "hub-silver-tier": { month: 10, year: 110 } },
  },
  deu: {
    currency: "EUR",
    plans: { "hub-silver-tier": { month: 10, year: 110 } },
  },
  sgp: {
    currency: "SGD",
    plans: { "hub-silver-tier": { month: 10, year: 110 } },
  },
  ind1: {
    currency: "INR",
    plans: { "hub-silver-tier": { month: 1000, year: 11000 } },
  },
} as const satisfies Record<string, TenantPrices>;

export interface Price {
  amount: number;
  currency: string;
}

/**
 * Returns undefined for a plan or tenant this portal has no price for, such
 * as `hub-free-tier` or a newly added tenant. The portal hides a paid plan it
 * cannot price.
 */
export function planPrice(
  tenantID: string,
  plan: HubPlan,
  interval: BillingInterval,
): Price | undefined {
  if (!Object.hasOwn(prices, tenantID)) return undefined;
  const tenant = (prices as Record<string, TenantPrices>)[tenantID];
  if (tenant === undefined) return undefined;
  const planPrices = tenant.plans[plan];
  if (planPrices === undefined) return undefined;
  return { amount: planPrices[interval], currency: tenant.currency };
}
