import {
  FreeTier,
  isOrgPlan,
  type OrgPlan,
  plans,
} from "typespec/orgs/subscriptions/plans";

export interface OrgRegionSettings {
  readonly orgPlans: readonly OrgPlan[];
}

/**
 * Validates the Orgs portal's own per-region settings against the shared
 * region table, so a build cannot ship a region without plans.
 */
export function parseOrgRegionSettings(
  raw: unknown,
  tenantIds: readonly string[],
): ReadonlyMap<string, OrgRegionSettings> {
  const entries =
    typeof raw === "object" && raw !== null && "regions" in raw
      ? raw.regions
      : undefined;
  if (!Array.isArray(entries)) throw new Error("regions must be an array");
  const settings = new Map<string, OrgRegionSettings>();
  for (const [index, entry] of entries.entries()) {
    const at = `regions[${index}]`;
    const { tenantId, orgPlans } = (entry ?? {}) as Record<string, unknown>;
    if (
      typeof tenantId !== "string" ||
      !tenantIds.includes(tenantId) ||
      settings.has(tenantId)
    ) {
      throw new Error(`${at}.tenantId must be a unique region in the table`);
    }
    if (
      !Array.isArray(orgPlans) ||
      !orgPlans.every(isOrgPlan) ||
      new Set(orgPlans).size !== orgPlans.length ||
      !orgPlans.includes(FreeTier)
    ) {
      throw new Error(
        `${at}.orgPlans must be unique known plans including ${FreeTier}`,
      );
    }
    settings.set(tenantId, {
      orgPlans: plans.filter((plan) => orgPlans.includes(plan)),
    });
  }
  const missing = tenantIds.find((tenantId) => !settings.has(tenantId));
  if (missing !== undefined) {
    throw new Error(`region ${missing} has no Org settings`);
  }
  return settings;
}
