export type FrontendLocale = "en-US" | "ta" | "de-DE";

export const EnglishUnitedStates: FrontendLocale = "en-US";
export const Tamil: FrontendLocale = "ta";
export const German: FrontendLocale = "de-DE";

export type CountryCode = string;

export type DisplayName = string;

export function isFrontendLocale(value: unknown): value is FrontendLocale {
  return value === "en-US" || value === "ta" || value === "de-DE";
}

export function normalizeDisplayName(value: DisplayName): DisplayName {
  return value.trim();
}

export function isDisplayName(value: DisplayName): boolean {
  const length = [...normalizeDisplayName(value)].length;
  return length >= 1 && length <= 200;
}
