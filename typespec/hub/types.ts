export const frontendLocaleValues = ["en-US", "ta", "de-DE"] as const;

export type FrontendLocale = (typeof frontendLocaleValues)[number];

const frontendLocales = new Set<string>(frontendLocaleValues);

export function isFrontendLocale(value: unknown): value is FrontendLocale {
  return typeof value === "string" && frontendLocales.has(value);
}

export type HubUserDID = string;
export type HubHandle = string;

export function isHubUserDID(value: HubUserDID): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function isHubHandle(value: HubHandle): boolean {
  return /^[a-z0-9]{5}-[0-9a-hjkmnp-tv-z]{11}$/.test(value);
}
