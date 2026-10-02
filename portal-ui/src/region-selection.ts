import type { PortalRegion, RegionTable } from "./regions.ts";

export function findRegion(
  table: RegionTable,
  tenantId: unknown,
): PortalRegion | undefined {
  return table.regions.find((region) => region.tenantId === tenantId);
}

/**
 * The region pre-selected on a sign-in page: the one this browser last chose,
 * else the one recommended for the country in the browser's first language
 * tag that names one, else the table's default. Only an explicit region
 * subtag counts; inferring a country from a bare language would place, for
 * example, every "en" speaker in the United States.
 */
export function initialRegion(
  table: RegionTable,
  remembered: string | null,
  languages: readonly string[],
): string {
  if (findRegion(table, remembered) !== undefined) {
    return remembered as string;
  }
  for (const tag of languages) {
    let country: string | undefined;
    try {
      country = new Intl.Locale(tag).region;
    } catch {
      continue;
    }
    if (country === undefined) continue;
    const recommended =
      table.recommendations[country as keyof RegionTable["recommendations"]];
    return recommended ?? table.defaultTenant;
  }
  return table.defaultTenant;
}

/**
 * Holds the chosen region and remembers it per browser under the caller's
 * storage key. Storage may be unavailable or cleared, so the choice is also
 * kept in memory for this page, and a fresh page falls back to
 * `initialRegion`'s other sources.
 */
export function createRegionStore({
  key,
  table,
}: {
  key: string;
  table: RegionTable;
}) {
  let selected: string | null = null;
  return {
    read: (): string => {
      if (selected !== null) return selected;
      let remembered: string | null = null;
      try {
        remembered = globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        // Fall back to the browser's languages and the table default.
      }
      return initialRegion(
        table,
        remembered,
        globalThis.navigator?.languages ?? [],
      );
    },
    remember: (tenantId: string): void => {
      if (findRegion(table, tenantId) === undefined) return;
      selected = tenantId;
      try {
        globalThis.localStorage?.setItem(key, tenantId);
      } catch {
        // The in-memory choice still applies to this page.
      }
    },
  };
}

/**
 * Reads the `region` parameter an emailed link carries. The link is
 * attacker-controllable, so only a region in the compiled-in table is
 * accepted; anything else is `null`, which the caller presents as an invalid
 * link rather than guessing a region.
 */
export function regionFromSearchParams(
  table: RegionTable,
  params: URLSearchParams,
): string | null {
  const values = params.getAll("region");
  if (values.length !== 1) return null;
  return findRegion(table, values[0])?.tenantId ?? null;
}

/**
 * Builds the API origin provider for a regional portal. A signed-in session
 * is bound to the region that issued its token, so its region wins over the
 * picker: changing the picker must never send that token to another region.
 */
export function createRegionalAPIOrigin({
  table,
  sessionTenant,
  selectedTenant,
}: {
  table: RegionTable;
  sessionTenant: () => string | null;
  selectedTenant: () => string;
}): () => string {
  return () => {
    const tenantId = sessionTenant() ?? selectedTenant();
    const region = findRegion(table, tenantId);
    if (region === undefined) {
      throw new Error(`unknown region ${JSON.stringify(tenantId)}`);
    }
    return region.apiOrigin;
  };
}
