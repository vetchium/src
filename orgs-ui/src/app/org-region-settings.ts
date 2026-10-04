import {
  FreeTier,
  isOrgPlan,
  type OrgPlan,
  plans,
} from "typespec/orgs/subscriptions/plans";

export interface OrgRegionSettings {
  /** Whether the region admits signups for special-use names such as
   * acme.test; mirrors the tenant's orgsAPIServer.allowSpecialUseDomains. */
  readonly allowSpecialUseDomains: boolean;
  /** Where this region's signed logo URLs are served from. */
  readonly mediaOrigin: string;
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
    const { tenantId, allowSpecialUseDomains, mediaOrigin, orgPlans } =
      (entry ?? {}) as Record<string, unknown>;
    if (
      typeof tenantId !== "string" ||
      !tenantIds.includes(tenantId) ||
      settings.has(tenantId)
    ) {
      throw new Error(`${at}.tenantId must be a unique region in the table`);
    }
    if (typeof allowSpecialUseDomains !== "boolean") {
      throw new Error(`${at}.allowSpecialUseDomains must be a boolean`);
    }
    if (typeof mediaOrigin !== "string" || !isOrigin(mediaOrigin)) {
      throw new Error(`${at}.mediaOrigin must be an origin`);
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
      allowSpecialUseDomains,
      mediaOrigin,
      orgPlans: plans.filter((plan) => orgPlans.includes(plan)),
    });
  }
  const missing = tenantIds.find((tenantId) => !settings.has(tenantId));
  if (missing !== undefined) {
    throw new Error(`region ${missing} has no Org settings`);
  }
  return settings;
}

/**
 * The DNS-over-HTTPS (RFC 8484) endpoint the signup completion page asks for
 * the TXT record before submitting: a public resolver in production, the
 * development DNS server's front in dev and CI.
 */
export function parseDNSOverHTTPS(raw: unknown): string {
  const value =
    typeof raw === "object" && raw !== null && "dnsOverHTTPS" in raw
      ? raw.dnsOverHTTPS
      : undefined;
  if (typeof value !== "string" || !isEndpoint(value)) {
    throw new Error("dnsOverHTTPS must be an http(s) URL without a query");
  }
  return value;
}

function isEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.href === value &&
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
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
