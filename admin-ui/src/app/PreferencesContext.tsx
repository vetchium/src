import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { FrontendLocale } from "../../../typespec/common/localization.ts";
import i18n from "../i18n";
import {
  htmlLanguage,
  readPreferredLanguage,
  readThemeMode,
  storePreferredLanguage,
  storeThemeMode,
  type ThemeMode,
} from "./preferences";

interface PreferencesContextValue {
  language: FrontendLocale;
  themeMode: ThemeMode;
  setLanguage: (language: FrontendLocale) => void;
  toggleTheme: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState(readPreferredLanguage);
  const [themeMode, setThemeMode] = useState(readThemeMode);

  useEffect(() => {
    document.documentElement.lang = htmlLanguage(language);
    void i18n.changeLanguage(language);
  }, [language]);

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
  if (value === null) {
    throw new Error("PreferencesProvider is missing");
  }
  return value;
}
