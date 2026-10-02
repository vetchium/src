import {
  FreeTier,
  type HubPlan,
  isHubPlan,
  plans,
} from "typespec/hub/subscriptions/plans";

export interface HubRegionSettings {
  readonly mediaOrigin: string;
  readonly hubPlans: readonly HubPlan[];
}

/**
 * Validates the Hub's own per-region settings against the shared region
 * table, so a build cannot ship a region without plans or a media origin.
 */
export function parseHubRegionSettings(
  raw: unknown,
  tenantIds: readonly string[],
): ReadonlyMap<string, HubRegionSettings> {
  const entries =
    typeof raw === "object" && raw !== null && "regions" in raw
      ? raw.regions
      : undefined;
  if (!Array.isArray(entries)) throw new Error("regions must be an array");
  const settings = new Map<string, HubRegionSettings>();
  for (const [index, entry] of entries.entries()) {
    const at = `regions[${index}]`;
    const { tenantId, mediaOrigin, hubPlans } = (entry ?? {}) as Record<
      string,
      unknown
    >;
    if (
      typeof tenantId !== "string" ||
      !tenantIds.includes(tenantId) ||
      settings.has(tenantId)
    ) {
      throw new Error(`${at}.tenantId must be a unique region in the table`);
    }
    if (typeof mediaOrigin !== "string" || !isOrigin(mediaOrigin)) {
      throw new Error(`${at}.mediaOrigin must be an origin`);
    }
    if (
      !Array.isArray(hubPlans) ||
      !hubPlans.every(isHubPlan) ||
      new Set(hubPlans).size !== hubPlans.length ||
      !hubPlans.includes(FreeTier)
    ) {
      throw new Error(
        `${at}.hubPlans must be unique known plans including ${FreeTier}`,
      );
    }
    settings.set(tenantId, {
      mediaOrigin,
      hubPlans: plans.filter((plan) => hubPlans.includes(plan)),
    });
  }
  const missing = tenantIds.find((tenantId) => !settings.has(tenantId));
  if (missing !== undefined) {
    throw new Error(`region ${missing} has no Hub settings`);
  }
  return settings;
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === "https:" || url.protocol === "http:")
    );
  } catch {
    return false;
  }
}
