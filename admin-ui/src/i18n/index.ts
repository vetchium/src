import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { readPreferredLanguage } from "../app/preferences";
import { de } from "./locales/de";
import { en } from "./locales/en";
import { ta } from "./locales/ta";

void i18n.use(initReactI18next).init({
  fallbackLng: "en-US",
  lng: readPreferredLanguage(),
  resources: {
    "en-US": {
      translation: en,
    },
    ta: {
      translation: ta,
    },
    de_DE: {
      translation: de,
    },
  },
  interpolation: {
    escapeValue: false,
  },
  // Permission IDs are translation object keys (for example,
  // `admin:view_users`), not i18next namespace-qualified keys.
  nsSeparator: false,
});

export default i18n;
