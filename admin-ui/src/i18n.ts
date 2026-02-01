import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Import translations
import enUSCommon from "./locales/en-US/common.json";
import enUSAuth from "./locales/en-US/auth.json";
import enUSApprovedDomains from "./locales/en-US/approved-domains.json";
import enUSUserManagement from "./locales/en-US/user-management.json";
import deDECommon from "./locales/de-DE/common.json";
import deDEAuth from "./locales/de-DE/auth.json";
import deDEApprovedDomains from "./locales/de-DE/approved-domains.json";
import deDEUserManagement from "./locales/de-DE/user-management.json";
import taINCommon from "./locales/ta-IN/common.json";
import taINAuth from "./locales/ta-IN/auth.json";
import taINApprovedDomains from "./locales/ta-IN/approved-domains.json";
import taINUserManagement from "./locales/ta-IN/user-management.json";

export const SUPPORTED_LANGUAGES = ["en-US", "de-DE", "ta-IN"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = "en-US";

const LANGUAGE_STORAGE_KEY = "vetchium_admin_language";

export function getStoredLanguage(): SupportedLanguage {
	const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
	if (stored && SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage)) {
		return stored as SupportedLanguage;
	}

	// Try browser locale
	const browserLang = navigator.language;
	if (SUPPORTED_LANGUAGES.includes(browserLang as SupportedLanguage)) {
		return browserLang as SupportedLanguage;
	}

	// Try language without region (e.g., 'en' from 'en-GB')
	const langOnly = browserLang.split("-")[0];
	const matchingLang = SUPPORTED_LANGUAGES.find((l) =>
		l.startsWith(langOnly + "-")
	);
	if (matchingLang) {
		return matchingLang;
	}

	return DEFAULT_LANGUAGE;
}

export function setStoredLanguage(language: SupportedLanguage): void {
	localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

const resources = {
	"en-US": {
		common: enUSCommon,
		auth: enUSAuth,
		approvedDomains: enUSApprovedDomains,
		userManagement: enUSUserManagement,
	},
	"de-DE": {
		common: deDECommon,
		auth: deDEAuth,
		approvedDomains: deDEApprovedDomains,
		userManagement: deDEUserManagement,
	},
	"ta-IN": {
		common: taINCommon,
		auth: taINAuth,
		approvedDomains: taINApprovedDomains,
		userManagement: taINUserManagement,
	},
};

i18n.use(initReactI18next).init({
	resources,
	lng: getStoredLanguage(),
	fallbackLng: DEFAULT_LANGUAGE,
	defaultNS: "common",
	ns: ["common", "auth", "approvedDomains", "userManagement"],
	interpolation: {
		escapeValue: false, // React already escapes
	},
});

export default i18n;
