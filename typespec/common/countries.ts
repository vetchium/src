import { iso31661 } from "iso-3166";
import type { CountryCode } from "./localization.ts";

export const countryCodeValues: readonly CountryCode[] = iso31661.map(
  ({ alpha2 }) => alpha2,
);

const countryCodes = new Set<string>(countryCodeValues);

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === "string" && countryCodes.has(value);
}
