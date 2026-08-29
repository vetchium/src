import type { i18n } from "i18next";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  type FrontendLocale,
  isFrontendLocale,
} from "typespec/common/localization";

export type ThemeMode = "light" | "dark";

const languageStorageKey = "vetchium.language";
const themeStorageKey = "vetchium.theme";

interface RuntimeConfig {
  defaultLanguage?: unknown;
}

function runtimeDefaultLanguage(): FrontendLocale {
  const config = (
    globalThis as typeof globalThis & {
      __VETCHIUM_CONFIG__?: RuntimeConfig;
    }
  ).__VETCHIUM_CONFIG__;
  return isFrontendLocale(config?.defaultLanguage)
    ? config.defaultLanguage
    : "en-US";
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

export function readPreferredLanguage(): FrontendLocale {
  const stored = storedValue(languageStorageKey);
  return isFrontendLocale(stored) ? stored : runtimeDefaultLanguage();
}

export function storePreferredLanguage(language: FrontendLocale): void {
  storeValue(languageStorageKey, language);
}

export function readThemeMode(): ThemeMode {
  return storedValue(themeStorageKey) === "dark" ? "dark" : "light";
}

export function storeThemeMode(themeMode: ThemeMode): void {
  storeValue(themeStorageKey, themeMode);
}

export function intlLocale(language: string): string {
  return language === "de-DE" ? "de-DE" : language;
}

interface PreferencesContextValue {
  language: FrontendLocale;
  themeMode: ThemeMode;
  setLanguage: (language: FrontendLocale) => void;
  toggleTheme: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({
  children,
  i18n: translation,
}: PropsWithChildren<{ i18n: i18n }>) {
  const [language, setLanguageState] = useState(readPreferredLanguage);
  const [themeMode, setThemeMode] = useState(readThemeMode);

  useEffect(() => {
    document.documentElement.lang = language;
    void translation.changeLanguage(language);
  }, [language, translation]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      language,
      themeMode,
      setLanguage: (nextLanguage) => {
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
    [language, themeMode],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (value === null) throw new Error("PreferencesProvider is missing");
  return value;
}
