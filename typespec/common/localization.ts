export const frontendLocaleValues = ["en-US", "ta", "de-DE"] as const;

export type FrontendLocale = (typeof frontendLocaleValues)[number];

const frontendLocales = new Set<string>(frontendLocaleValues);

export type CountryCode = string;

export type DisplayName = string;

export function isFrontendLocale(value: unknown): value is FrontendLocale {
  return typeof value === "string" && frontendLocales.has(value);
}

export function normalizeDisplayName(value: DisplayName): DisplayName {
  return value.trim();
}

export function isDisplayName(value: DisplayName): boolean {
  const length = [...normalizeDisplayName(value)].length;
  return length >= 1 && length <= 200;
}
