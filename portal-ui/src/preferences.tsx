import type { i18n } from "i18next";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PortalLocaleConfiguration } from "./localization";
import { matchFrontendLocale } from "./localization";
import { runtimeConfigValue } from "./runtime-config";

export type ThemeMode = "light" | "dark";

/** A primary color the person may pick in place of the portal's own. */
export interface PrimaryColorChoice {
  /** Stored in the browser, so it must stay stable across releases. */
  key: string;
  /** The seed color; Ant Design derives every primary shade from it. */
  color: string;
  /** Translation key naming the color. */
  labelKey: string;
}

const languageStorageKey = "vetchium.language";
const themeStorageKey = "vetchium.theme";
const primaryColorStorageKey = "vetchium.primaryColor";

function runtimeDefaultLanguage<Locale extends string>(
  localization: PortalLocaleConfiguration<Locale>,
): Locale {
  const defaultLanguage = runtimeConfigValue("defaultLanguage");
  return localization.isSupportedLocale(defaultLanguage)
    ? defaultLanguage
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

function removeValue(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
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

/**
 * The stored choice's key, or null for the portal's own color, including when
 * the stored choice is no longer offered.
 */
function readPrimaryColorChoice(
  choices: readonly PrimaryColorChoice[],
): string | null {
  const stored = storedValue(primaryColorStorageKey);
  return choices.some(({ key }) => key === stored) ? stored : null;
}

function storePrimaryColorChoice(key: string | null): void {
  if (key === null) removeValue(primaryColorStorageKey);
  else storeValue(primaryColorStorageKey, key);
}

export interface PreferencesContextValue<Locale extends string> {
  language: Locale;
  supportedLocales: readonly Locale[];
  themeMode: ThemeMode;
  /** The color in effect: the chosen one, else the portal's own. */
  primaryColor: string;
  /** The portal's own color, which applies until a choice is made. */
  portalPrimaryColor: string;
  /** The chosen key, or null while the portal's own color applies. */
  primaryColorChoice: string | null;
  /** Empty when the portal offers no choice of color. */
  primaryColorChoices: readonly PrimaryColorChoice[];
  setLanguage: (language: Locale) => void;
  toggleTheme: () => void;
  /** Null restores the portal's own color; an unoffered key is ignored. */
  setPrimaryColorChoice: (key: string | null) => void;
}

const noPrimaryColorChoices: readonly PrimaryColorChoice[] = [];

const PreferencesContext =
  createContext<PreferencesContextValue<string> | null>(null);

export function PreferencesProvider<Locale extends string>({
  children,
  i18n: translation,
  localization,
  primaryColor,
  primaryColorChoices = noPrimaryColorChoices,
}: PropsWithChildren<{
  i18n: i18n;
  localization: PortalLocaleConfiguration<Locale>;
  /** The portal's own color, used until the person picks a choice. */
  primaryColor: string;
  primaryColorChoices?: readonly PrimaryColorChoice[];
}>) {
  const [language, setLanguageState] = useState(() =>
    readPreferredLanguage(localization),
  );
  const [themeMode, setThemeMode] = useState(readThemeMode);
  const [primaryColorChoice, setPrimaryColorChoiceState] = useState(() =>
    readPrimaryColorChoice(primaryColorChoices),
  );

  useEffect(() => {
    document.documentElement.lang = language;
    void translation.changeLanguage(language);
  }, [language, translation]);

  const value = useMemo<PreferencesContextValue<string>>(
    () => ({
      language,
      supportedLocales: localization.supportedLocales,
      themeMode,
      primaryColor:
        primaryColorChoices.find(({ key }) => key === primaryColorChoice)
          ?.color ?? primaryColor,
      portalPrimaryColor: primaryColor,
      primaryColorChoice,
      primaryColorChoices,
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
      setPrimaryColorChoice: (key) => {
        if (key !== null && !primaryColorChoices.some((c) => c.key === key))
          return;
        storePrimaryColorChoice(key);
        setPrimaryColorChoiceState(key);
      },
    }),
    [
      language,
      localization,
      themeMode,
      primaryColor,
      primaryColorChoice,
      primaryColorChoices,
    ],
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
