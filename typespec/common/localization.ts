export type CountryCode = string;

export type DisplayName = string;

export function normalizeDisplayName(value: DisplayName): DisplayName {
  return value.trim();
}

export function isDisplayName(value: DisplayName): boolean {
  const length = [...normalizeDisplayName(value)].length;
  return length >= 1 && length <= 200;
}
