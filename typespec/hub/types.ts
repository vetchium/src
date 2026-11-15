export const frontendLocaleValues = ["en-US", "ta", "de-DE"] as const;

export type FrontendLocale = (typeof frontendLocaleValues)[number];

const frontendLocales = new Set<string>(frontendLocaleValues);

export function isFrontendLocale(value: unknown): value is FrontendLocale {
  return typeof value === "string" && frontendLocales.has(value);
}

export type HubUserDID = string;
export type HubHandle = string;

/** Plain text of 1 to 2,000 code points after trimming (PROF-JOB-001). */
export type IdealJob = string;

export const maxIdealJobCodePoints = 2000;

/** Trimmed text of 1 to 2,000 code points without U+0000, which PostgreSQL
 * text cannot hold. */
export function isIdealJob(value: string): boolean {
  const size = [...value].length;
  return size >= 1 && size <= maxIdealJobCodePoints && !value.includes("\0");
}

export function isHubUserDID(value: HubUserDID): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function isHubHandle(value: HubHandle): boolean {
  return /^[a-z0-9]{8}-[0-9a-hjkmnp-tv-z]{11}$/.test(value);
}
