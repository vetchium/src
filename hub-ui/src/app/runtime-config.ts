import { runtimeConfigValue } from "@vetchium/portal-ui/runtime-config";
import {
  DefaultPlan,
  type HubPlan,
  isHubPlan,
  plans,
} from "typespec/hub/subscriptions/plans";

/** Returns `null` when the runtime configuration carries no tenant ID. */
export function configuredTenantID(): string | null {
  const tenantId = runtimeConfigValue("tenantId");
  return typeof tenantId === "string" && tenantId !== "" ? tenantId : null;
}

/**
 * Keeps known plans in rank order, drops unknown values, and always includes
 * the free tier. A missing or malformed runtime value degrades to the free
 * plan only, rather than breaking the portal.
 */
export function configuredPlans(): readonly HubPlan[] {
  const configured = runtimeConfigValue("hubPlans");
  const known = new Set<HubPlan>();
  if (Array.isArray(configured)) {
    for (const value of configured) {
      if (isHubPlan(value)) known.add(value);
    }
  }
  known.add(DefaultPlan);
  return plans.filter((plan) => known.has(plan));
}
