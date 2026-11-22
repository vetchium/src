import { findRegion } from "@vetchium/portal-ui/region-selection";
import type { PortalRegion } from "@vetchium/portal-ui/regions";
import type { TFunction } from "i18next";
import type { FrontendLocale } from "typespec/hub/types";
import { regionTable } from "../../app/regions";
import { countryName } from "../../i18n/countries";

const { regions } = regionTable;

// A hosting country names its region until two regions share one.
export const regionOptionKey =
  new Set(regions.map((region) => region.hostingCountry)).size ===
  regions.length
    ? "region.option"
    : "region.sharedOption";

export function regionName(
  t: TFunction,
  region: PortalRegion,
  locale: FrontendLocale,
): string {
  return t(regionOptionKey, {
    country: countryName(region.hostingCountry, locale),
    tenantId: region.tenantId,
  });
}

/** `regionName` for a tenant id, which stands in for an unknown region. */
export function regionNameOf(
  t: TFunction,
  tenantId: string,
  locale: FrontendLocale,
): string {
  const region = findRegion(regionTable, tenantId);
  return region === undefined ? tenantId : regionName(t, region, locale);
}
