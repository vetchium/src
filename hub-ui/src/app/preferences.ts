import {
  type FrontendLocale,
  isFrontendLocale,
} from "../../../typespec/common/localization.ts";

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
    // Browser privacy settings can disable storage. The in-memory setting
    // still applies for the current page.
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

export function htmlLanguage(language: FrontendLocale): string {
  return language === "de_DE" ? "de-DE" : language;
}
