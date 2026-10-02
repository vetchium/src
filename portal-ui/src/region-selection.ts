import type { PortalRegion, RegionTable } from "./regions.ts";
import { createRememberedSessionStorage } from "./session.ts";

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
 * Holds the region sign-in requests go to. `select` sets it for this page;
 * `remember` also keeps it for this browser under the caller's storage key.
 * Storage may be unavailable or cleared, so a fresh page falls back to
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
  const select = (tenantId: string): boolean => {
    if (findRegion(table, tenantId) === undefined) return false;
    selected = tenantId;
    return true;
  };
  return {
    select: (tenantId: string): void => {
      select(tenantId);
    },
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
      if (!select(tenantId)) return;
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

export interface RegionalSession<Session> {
  tenantId: string;
  session: Session;
}

/**
 * Stores a session together with the region that issued it. A stored session
 * naming no region, or one missing from the compiled-in table, reads as no
 * session: its token is only meaningful to the region that issued it.
 */
export function createRegionalSessionStorage<Session>({
  key,
  table,
  parse,
}: {
  key: string;
  table: RegionTable;
  parse: (value: unknown) => Session | null;
}) {
  return createRememberedSessionStorage<RegionalSession<Session>>({
    key,
    parse: (value) => {
      if (!value) return null;
      try {
        const stored: unknown = JSON.parse(value);
        if (typeof stored !== "object" || stored === null) return null;
        const { tenantId, session } = stored as Record<string, unknown>;
        const region = findRegion(table, tenantId);
        const parsed = parse(session);
        if (region === undefined || parsed === null) return null;
        return { tenantId: region.tenantId, session: parsed };
      } catch {
        return null;
      }
    },
  });
}
