import type { PortalRegion } from "@vetchium/portal-ui/regions";
import { isCountryCode } from "typespec/common/countries";
import type { CountryCode } from "typespec/common/localization";
import { regionTable } from "../../app/regions";

/** Regions accepting Hub signup from residents of `country`. The destination
 * region still decides admission; this only avoids offering a region whose
 * compiled-in policy would refuse. */
export function eligibleRegions(
  country: string | undefined,
): readonly PortalRegion[] {
  if (country === undefined || !isCountryCode(country)) return [];
  return regionTable.regions.filter(
    (region) =>
      region.signupEnabled &&
      (region.allowedCountries.length === 0 ||
        region.allowedCountries.includes(country)),
  );
}

/** The country's recommendation, else the table default, when eligible. */
export function recommendedRegion(
  country: string | undefined,
): PortalRegion | undefined {
  const preferred =
    regionTable.recommendations[country as CountryCode] ??
    regionTable.defaultTenant;
  return eligibleRegions(country).find(
    (region) => region.tenantId === preferred,
  );
}
