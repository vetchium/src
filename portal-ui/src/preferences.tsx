import type { i18n } from "i18next";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PortalLocaleConfiguration } from "./localization";
import { matchFrontendLocale } from "./localization";
import { runtimeConfigValue } from "./runtime-config";

export type ThemeMode = "light" | "dark";

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

const hexColorPattern = /^#[0-9a-f]{6}$/;

function relativeLuminance(hexColor: string): number {
  const linear = (start: number) => {
    const channel = Number.parseInt(hexColor.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

/**
 * Whether a lowercase `#rrggbb` color may be the primary color: Ant Design
 * puts white text on it (primary buttons), which needs a WCAG contrast of 3:1
 * or better.
 */
export function isUsablePrimaryColor(color: string): boolean {
  return (
    hexColorPattern.test(color) && 1.05 / (relativeLuminance(color) + 0.05) >= 3
  );
}

/**
 * The stored color, or null for the portal's own, including when the stored
 * value is not a usable color.
 */
function readChosenPrimaryColor(): string | null {
  const stored = storedValue(primaryColorStorageKey);
  return stored !== null && isUsablePrimaryColor(stored) ? stored : null;
}

function storeChosenPrimaryColor(color: string | null): void {
  if (color === null) removeValue(primaryColorStorageKey);
  else storeValue(primaryColorStorageKey, color);
}

export interface PreferencesContextValue<Locale extends string> {
  language: Locale;
  supportedLocales: readonly Locale[];
  themeMode: ThemeMode;
  /** The color in effect: the chosen one, else the portal's own. */
  primaryColor: string;
  /**
   * Swatches offered first, the portal's own color among them. Empty when the
   * portal offers no choice of color.
   */
  primaryColorPresets: readonly string[];
  setLanguage: (language: Locale) => void;
  toggleTheme: () => void;
  /**
   * Takes a lowercase `#rrggbb` color; one that is not usable is ignored, and
   * the portal's own color clears the choice.
   */
  setPrimaryColor: (color: string) => void;
}

const noPrimaryColorPresets: readonly string[] = [];

const PreferencesContext =
  createContext<PreferencesContextValue<string> | null>(null);

export function PreferencesProvider<Locale extends string>({
  children,
  i18n: translation,
  localization,
  primaryColor,
  primaryColorPresets = noPrimaryColorPresets,
}: PropsWithChildren<{
  i18n: i18n;
  localization: PortalLocaleConfiguration<Locale>;
  /** The portal's own lowercase `#rrggbb` color, used until one is chosen. */
  primaryColor: string;
  primaryColorPresets?: readonly string[];
}>) {
  const [language, setLanguageState] = useState(() =>
    readPreferredLanguage(localization),
  );
  const [themeMode, setThemeMode] = useState(readThemeMode);
  const [chosenPrimaryColor, setChosenPrimaryColor] = useState(
    readChosenPrimaryColor,
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
      // A portal offering no choice ignores one stored by another portal on
      // the same origin.
      primaryColor:
        primaryColorPresets.length === 0
          ? primaryColor
          : (chosenPrimaryColor ?? primaryColor),
      primaryColorPresets,
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
      setPrimaryColor: (color) => {
        if (primaryColorPresets.length === 0 || !isUsablePrimaryColor(color))
          return;
        const chosen = color === primaryColor ? null : color;
        storeChosenPrimaryColor(chosen);
        setChosenPrimaryColor(chosen);
      },
    }),
    [
      language,
      localization,
      themeMode,
      primaryColor,
      chosenPrimaryColor,
      primaryColorPresets,
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
