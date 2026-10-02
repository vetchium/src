import { FreeTier, type OrgPlan } from "typespec/orgs/subscriptions/plans";
import { planPrice } from "./prices";

/**
 * Keeps `org-free-tier`, plus each paid plan with both a monthly and an
 * annual price for the tenant. A paid plan without a price, such as on a newly
 * added tenant, is hidden.
 */
export function presentablePlans(
  tenantID: string,
  configured: readonly OrgPlan[],
): readonly OrgPlan[] {
  return configured.filter((plan) => {
    if (plan === FreeTier) return true;
    return (
      planPrice(tenantID, plan, "month") !== undefined &&
      planPrice(tenantID, plan, "year") !== undefined
    );
  });
}
