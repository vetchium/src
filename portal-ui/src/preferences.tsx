import type { i18n } from "i18next";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PortalLocaleConfiguration } from "./localization";
import { matchFrontendLocale } from "./localization";

export type ThemeMode = "light" | "dark";

const languageStorageKey = "vetchium.language";
const themeStorageKey = "vetchium.theme";

interface RuntimeConfig {
  defaultLanguage?: unknown;
}

function runtimeDefaultLanguage<Locale extends string>(
  localization: PortalLocaleConfiguration<Locale>,
): Locale {
  const config = (
    globalThis as typeof globalThis & {
      __VETCHIUM_CONFIG__?: RuntimeConfig;
    }
  ).__VETCHIUM_CONFIG__;
  return localization.isSupportedLocale(config?.defaultLanguage)
    ? config.defaultLanguage
    : localization.fallbackLocale;
}

function storedValue(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storeValue(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // The in-memory preference still applies for the current page.
  }
}

export function readPreferredLanguage<Locale extends string>(
  localization: PortalLocaleConfiguration<Locale>,
): Locale {
  const stored = storedValue(languageStorageKey);
  if (localization.isSupportedLocale(stored)) return stored;
  const browser = matchFrontendLocale(
    globalThis.navigator?.languages ?? [],
    localization.supportedLocales,
  );
  return browser ?? runtimeDefaultLanguage(localization);
}

export function storePreferredLanguage(language: string): void {
  storeValue(languageStorageKey, language);
}

export function readThemeMode(): ThemeMode {
  return storedValue(themeStorageKey) === "dark" ? "dark" : "light";
}

export function storeThemeMode(themeMode: ThemeMode): void {
  storeValue(themeStorageKey, themeMode);
}

export interface PreferencesContextValue<Locale extends string> {
  language: Locale;
  supportedLocales: readonly Locale[];
  themeMode: ThemeMode;
  setLanguage: (language: Locale) => void;
  toggleTheme: () => void;
}

const PreferencesContext =
  createContext<PreferencesContextValue<string> | null>(null);

export function PreferencesProvider<Locale extends string>({
  children,
  i18n: translation,
  localization,
}: PropsWithChildren<{
  i18n: i18n;
  localization: PortalLocaleConfiguration<Locale>;
}>) {
  const [language, setLanguageState] = useState(() =>
    readPreferredLanguage(localization),
  );
  const [themeMode, setThemeMode] = useState(readThemeMode);

  useEffect(() => {
    document.documentElement.lang = language;
    void translation.changeLanguage(language);
  }, [language, translation]);

  const value = useMemo<PreferencesContextValue<string>>(
    () => ({
      language,
      supportedLocales: localization.supportedLocales,
      themeMode,
      setLanguage: (nextLanguage) => {
        if (!localization.isSupportedLocale(nextLanguage)) return;
        storePreferredLanguage(nextLanguage);
        setLanguageState(nextLanguage);
      },
      toggleTheme: () => {
        setThemeMode((current) => {
          const next = current === "light" ? "dark" : "light";
          storeThemeMode(next);
          return next;
        });
      },
    }),
    [language, localization, themeMode],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue<string>;
export function usePreferences<Locale extends string>(
  localization: PortalLocaleConfiguration<Locale>,
): PreferencesContextValue<Locale>;
export function usePreferences<Locale extends string>(
  localization?: PortalLocaleConfiguration<Locale>,
): PreferencesContextValue<string> | PreferencesContextValue<Locale> {
  const value = useContext(PreferencesContext);
  if (value === null) throw new Error("PreferencesProvider is missing");
  if (localization === undefined) return value;
  if (!localization.isSupportedLocale(value.language)) {
    throw new Error("PreferencesProvider returned an unsupported language");
  }
  const supportedLocales = value.supportedLocales.filter(
    localization.isSupportedLocale,
  );
  if (supportedLocales.length !== value.supportedLocales.length) {
    throw new Error(
      "PreferencesProvider returned unsupported language options",
    );
  }
  return {
    ...value,
    language: value.language,
    supportedLocales,
  };
}
