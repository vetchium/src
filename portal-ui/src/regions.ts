import { isCountryCode } from "typespec/common/countries";
import type { CountryCode } from "typespec/common/localization";
import type { PortalEnvironment } from "./portal-environment.ts";

export {
  type PortalEnvironment,
  parsePortalEnvironment,
  portalEnvironments,
} from "./portal-environment.ts";

export interface PortalRegion {
  readonly tenantId: string;
  readonly hostingCountry: CountryCode;
  readonly apiOrigin: string;
  readonly signupEnabled: boolean;
  readonly orgSignupEnabled: boolean;
  readonly allowedCountries: readonly CountryCode[];
}

export interface RegionTable {
  readonly defaultTenant: string;
  readonly recommendations: Readonly<Partial<Record<CountryCode, string>>>;
  readonly regions: readonly PortalRegion[];
}

// Mirrors the backend's tenant id rule so the UI cannot hold a region the
// backend would refuse to name.
const tenantIdPattern = /^[a-z][a-z0-9-]{0,62}$/;

const regionMembers = [
  "tenantId",
  "hostingCountry",
  "apiOrigin",
  "signupEnabled",
  "orgSignupEnabled",
  "allowedCountries",
];
const tableMembers = ["defaultTenant", "recommendations", "regions"];

export function parseRegionTable(
  raw: unknown,
  environment: PortalEnvironment,
): RegionTable {
  const table = record(raw, "regionTable", tableMembers);
  if (!Array.isArray(table.regions) || table.regions.length === 0) {
    throw new Error("regions must be a non-empty array");
  }
  const tenants = new Set<string>();
  const origins = new Set<string>();
  const regions = table.regions.map((value: unknown, index: number) => {
    const at = `regions[${index}]`;
    const region = record(value, at, regionMembers);
    const { tenantId, hostingCountry, apiOrigin } = region;
    if (
      typeof tenantId !== "string" ||
      !tenantIdPattern.test(tenantId) ||
      tenants.has(tenantId)
    ) {
      throw new Error(`${at}.tenantId must be a unique tenant id`);
    }
    tenants.add(tenantId);
    if (!isCountryCode(hostingCountry)) {
      throw new Error(`${at}.hostingCountry must be a country code`);
    }
    if (
      typeof apiOrigin !== "string" ||
      !isOrigin(apiOrigin, environment === "production") ||
      origins.has(apiOrigin)
    ) {
      throw new Error(
        `${at}.apiOrigin must be a unique origin, HTTPS in production`,
      );
    }
    origins.add(apiOrigin);
    return {
      tenantId,
      hostingCountry,
      apiOrigin,
      signupEnabled: boolean(region.signupEnabled, `${at}.signupEnabled`),
      orgSignupEnabled: boolean(
        region.orgSignupEnabled,
        `${at}.orgSignupEnabled`,
      ),
      allowedCountries: countries(
        region.allowedCountries,
        `${at}.allowedCountries`,
      ),
    };
  });

  if (
    typeof table.defaultTenant !== "string" ||
    !tenants.has(table.defaultTenant)
  ) {
    throw new Error("defaultTenant must name a region in the table");
  }
  const recommendations: Partial<Record<CountryCode, string>> = {};
  for (const [country, tenant] of Object.entries(
    record(table.recommendations, "recommendations"),
  )) {
    if (
      !isCountryCode(country) ||
      typeof tenant !== "string" ||
      !tenants.has(tenant)
    ) {
      throw new Error(
        `recommendations.${country} must map a country code to a region in the table`,
      );
    }
    recommendations[country] = tenant;
  }
  return { defaultTenant: table.defaultTenant, recommendations, regions };
}

function record(
  value: unknown,
  at: string,
  members?: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${at} must be an object`);
  }
  const unknown = members
    ? Object.keys(value).find((key) => !members.includes(key))
    : undefined;
  if (unknown !== undefined) {
    throw new Error(`${at}.${unknown} is not a known member`);
  }
  return value as Record<string, unknown>;
}

function boolean(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${at} must be a boolean`);
  return value;
}

function countries(value: unknown, at: string): CountryCode[] {
  if (
    !Array.isArray(value) ||
    !value.every(isCountryCode) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${at} must be an array of unique country codes`);
  }
  return [...value];
}

function isOrigin(value: string, requireHTTPS: boolean): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.origin !== value) return false;
  return (
    url.protocol === "https:" || (!requireHTTPS && url.protocol === "http:")
  );
}
