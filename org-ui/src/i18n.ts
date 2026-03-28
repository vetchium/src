import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Import translations
import enUSCommon from "./locales/en-US/common.json";
import enUSAuth from "./locales/en-US/auth.json";
import enUSUserManagement from "./locales/en-US/user-management.json";
import enUSCostCenters from "./locales/en-US/cost-centers.json";
import enUSSubOrgs from "./locales/en-US/suborgs.json";
import enUSAuditLogs from "./locales/en-US/audit-logs.json";
import enUSMarketplace from "./locales/en-US/marketplace.json";
import deDECommon from "./locales/de-DE/common.json";
import deDEAuth from "./locales/de-DE/auth.json";
import deDEUserManagement from "./locales/de-DE/user-management.json";
import deDECostCenters from "./locales/de-DE/cost-centers.json";
import deDESubOrgs from "./locales/de-DE/suborgs.json";
import deDEAuditLogs from "./locales/de-DE/audit-logs.json";
import deDEMarketplace from "./locales/de-DE/marketplace.json";
import taINCommon from "./locales/ta-IN/common.json";
import taINAuth from "./locales/ta-IN/auth.json";
import taINUserManagement from "./locales/ta-IN/user-management.json";
import taINCostCenters from "./locales/ta-IN/cost-centers.json";
import taINSubOrgs from "./locales/ta-IN/suborgs.json";
import taINAuditLogs from "./locales/ta-IN/audit-logs.json";
import taINMarketplace from "./locales/ta-IN/marketplace.json";

export const SUPPORTED_LANGUAGES = ["en-US", "de-DE", "ta-IN"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = "en-US";

const LANGUAGE_STORAGE_KEY = "vetchium_org_language";

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
		userManagement: enUSUserManagement,
		"cost-centers": enUSCostCenters,
		suborgs: enUSSubOrgs,
		auditLogs: enUSAuditLogs,
		marketplace: enUSMarketplace,
	},
	"de-DE": {
		common: deDECommon,
		auth: deDEAuth,
		userManagement: deDEUserManagement,
		"cost-centers": deDECostCenters,
		suborgs: deDESubOrgs,
		auditLogs: deDEAuditLogs,
		marketplace: deDEMarketplace,
	},
	"ta-IN": {
		common: taINCommon,
		auth: taINAuth,
		userManagement: taINUserManagement,
		"cost-centers": taINCostCenters,
		suborgs: taINSubOrgs,
		auditLogs: taINAuditLogs,
		marketplace: taINMarketplace,
	},
};

i18n.use(initReactI18next).init({
	resources,
	lng: getStoredLanguage(),
	fallbackLng: DEFAULT_LANGUAGE,
	defaultNS: "common",
	ns: [
		"common",
		"auth",
		"userManagement",
		"cost-centers",
		"suborgs",
		"auditLogs",
		"marketplace",
	],
	interpolation: {
		escapeValue: false, // React already escapes
	},
});

export default i18n;
