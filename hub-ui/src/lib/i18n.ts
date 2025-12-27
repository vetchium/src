import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Import translations
import enCommon from "../locales/en-US/common.json";
import enSignup from "../locales/en-US/signup.json";
import deCommon from "../locales/de-DE/common.json";
import deSignup from "../locales/de-DE/signup.json";
import taCommon from "../locales/ta-IN/common.json";
import taSignup from "../locales/ta-IN/signup.json";

const resources = {
  "en-US": {
    common: enCommon,
    signup: enSignup,
  },
  "de-DE": {
    common: deCommon,
    signup: deSignup,
  },
  "ta-IN": {
    common: taCommon,
    signup: taSignup,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en-US", // Default language
  fallbackLng: "en-US",
  defaultNS: "common",
  interpolation: {
    escapeValue: false, // React already escapes values
  },
});

export default i18n;
