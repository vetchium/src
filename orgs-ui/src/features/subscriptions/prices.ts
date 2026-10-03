import type {
  BillingInterval,
  OrgPlan,
} from "typespec/orgs/subscriptions/plans";

interface PlanPrice {
  month: number;
  year: number;
}

interface TenantPrices {
  currency: string;
  plans: Partial<Record<OrgPlan, PlanPrice>>;
}

/**
 * Development display prices, keyed by tenant, plan, and interval; the portal
 * owns them until a real payment integration. A price is flat per plan and
 * interval, not per seat. The currency follows the Org's home tenant. The
 * annual price is eleven monthly payments and prices include tax.
 * `org-free-tier` has no entry: it has no price.
 */
export const prices = {
  usa1: {
    currency: "USD",
    plans: {
      "org-silver-tier": { month: 50, year: 550 },
      "org-gold-tier": { month: 200, year: 2200 },
    },
  },
  deu: {
    currency: "EUR",
    plans: {
      "org-silver-tier": { month: 50, year: 550 },
      "org-gold-tier": { month: 200, year: 2200 },
    },
  },
  sgp: {
    currency: "SGD",
    plans: {
      "org-silver-tier": { month: 50, year: 550 },
      "org-gold-tier": { month: 200, year: 2200 },
    },
  },
  ind1: {
    currency: "INR",
    plans: {
      "org-silver-tier": { month: 5000, year: 55000 },
      "org-gold-tier": { month: 20000, year: 220000 },
    },
  },
} as const satisfies Record<string, TenantPrices>;

export interface Price {
  amount: number;
  currency: string;
}

/**
 * Returns undefined for a plan or tenant this portal has no price for, such
 * as `org-free-tier` or a newly added tenant. The portal hides a paid plan it
 * cannot price.
 */
export function planPrice(
  tenantID: string,
  plan: OrgPlan,
  interval: BillingInterval,
): Price | undefined {
  if (!Object.hasOwn(prices, tenantID)) return undefined;
  const tenant = (prices as Record<string, TenantPrices>)[tenantID];
  if (tenant === undefined) return undefined;
  const planPrices = tenant.plans[plan];
  if (planPrices === undefined) return undefined;
  return { amount: planPrices[interval], currency: tenant.currency };
}
