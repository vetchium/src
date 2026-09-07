import type { PortalLocaleConfiguration } from "@vetchium/portal-ui/localization";
import {
  readPreferredLanguage as readPortalPreferredLanguage,
  usePreferences as usePortalPreferences,
} from "@vetchium/portal-ui/preferences";
import {
  type FrontendLocale,
  frontendLocaleValues,
  isFrontendLocale,
} from "typespec/hub/types";

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
