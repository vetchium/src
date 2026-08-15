import {
  canonicalLanguageSubtags,
  canonicalRegionSubtags,
} from "./canonical-locales.generated.ts";

export type FrontendLocale = "en-US" | "ta" | "de_DE";

export const EnglishUnitedStates: FrontendLocale = "en-US";
export const Tamil: FrontendLocale = "ta";
export const German: FrontendLocale = "de_DE";

export type RegionalLanguageCode = string;
export type DisplayName = string;

export interface LocalizedDisplayName {
  language_code: RegionalLanguageCode;
  display_name: DisplayName;
}

export function isFrontendLocale(value: unknown): value is FrontendLocale {
  return value === "en-US" || value === "ta" || value === "de_DE";
}

export function isRegionalLanguageCode(value: RegionalLanguageCode): boolean {
  return (
    /^[a-z]{2}-[A-Z]{2}$/.test(value) &&
    canonicalLanguageSubtags.has(value.slice(0, 2)) &&
    canonicalRegionSubtags.has(value.slice(3))
  );
}

export function normalizeDisplayName(value: DisplayName): DisplayName {
  return value.trim();
}

export function isDisplayName(value: DisplayName): boolean {
  const length = [...normalizeDisplayName(value)].length;
  return length >= 1 && length <= 200;
}
