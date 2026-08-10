import {
  canonicalLanguageSubtags,
  canonicalRegionSubtags,
} from "./canonical-locales.generated.ts";
import { canonicalTimeZoneIDs } from "./canonical-time-zones.generated.ts";

export type LanguageCode = "en-US" | "de-DE" | "ta-IN";

export const EnglishUnitedStates: LanguageCode = "en-US";
export const GermanGermany: LanguageCode = "de-DE";
export const TamilIndia: LanguageCode = "ta-IN";

export type RegionalLanguageCode = string;
export type TimeZoneID = string;
export type DisplayName = string;

export interface LocalizedDisplayName {
  language_code: RegionalLanguageCode;
  display_name: DisplayName;
}

export function isLanguageCode(value: LanguageCode): boolean {
  return value === "en-US" || value === "de-DE" || value === "ta-IN";
}

export function isRegionalLanguageCode(value: RegionalLanguageCode): boolean {
  return (
    /^[a-z]{2}-[A-Z]{2}$/.test(value) &&
    canonicalLanguageSubtags.has(value.slice(0, 2)) &&
    canonicalRegionSubtags.has(value.slice(3))
  );
}

export function isTimeZoneID(value: TimeZoneID): boolean {
  if (value.length < 1 || value.length > 255 || !value.includes("/")) {
    return false;
  }
  return canonicalTimeZoneIDs.has(value);
}

export function normalizeDisplayName(value: DisplayName): DisplayName {
  return value.trim();
}

export function isDisplayName(value: DisplayName): boolean {
  const length = [...normalizeDisplayName(value)].length;
  return length >= 1 && length <= 200;
}
