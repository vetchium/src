import type { PortalLocaleConfiguration } from "@vetchium/portal-ui/localization";
import {
  readPreferredLanguage as readPortalPreferredLanguage,
  usePreferences as usePortalPreferences,
} from "@vetchium/portal-ui/preferences";
import type { FrontendLocale as APILocale } from "typespec/orgs/types";

// The locales this portal ships complete translations for. The set belongs to
// the Orgs portal and does not have to match the other portals, but every
// entry must be a language the Orgs API accepts.
export const frontendLocaleValues = [
  "en-US",
  "ta",
  "de-DE",
] as const satisfies readonly APILocale[];

export type FrontendLocale = (typeof frontendLocaleValues)[number];

const frontendLocales = new Set<string>(frontendLocaleValues);

export function isFrontendLocale(value: unknown): value is FrontendLocale {
  return typeof value === "string" && frontendLocales.has(value);
}

export const localeConfiguration = {
  supportedLocales: frontendLocaleValues,
  fallbackLocale: "en-US",
  isSupportedLocale: isFrontendLocale,
} satisfies PortalLocaleConfiguration<FrontendLocale>;

export function readPreferredLanguage(): FrontendLocale {
  return readPortalPreferredLanguage(localeConfiguration);
}

export function usePreferences() {
  return usePortalPreferences(localeConfiguration);
}
