import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Import translations
import enUSCommon from "./locales/en-US/common.json";
import enUSAuth from "./locales/en-US/auth.json";
import enUSApprovedDomains from "./locales/en-US/approved-domains.json";
import enUSUserManagement from "./locales/en-US/user-management.json";
import enUSTags from "./locales/en-US/tags.json";
import enUSAuditLogs from "./locales/en-US/audit-logs.json";
import enUSOrgPlans from "./locales/en-US/org-plans.json";
import enUSMarketplace from "./locales/en-US/marketplace.json";
import deDECommon from "./locales/de-DE/common.json";
import deDEAuth from "./locales/de-DE/auth.json";
import deDEApprovedDomains from "./locales/de-DE/approved-domains.json";
import deDEUserManagement from "./locales/de-DE/user-management.json";
import deDETags from "./locales/de-DE/tags.json";
import deDEAuditLogs from "./locales/de-DE/audit-logs.json";
import deDEOrgPlans from "./locales/de-DE/org-plans.json";
import deDEMarketplace from "./locales/de-DE/marketplace.json";
import taINCommon from "./locales/ta-IN/common.json";
import taINAuth from "./locales/ta-IN/auth.json";
import taINApprovedDomains from "./locales/ta-IN/approved-domains.json";
import taINUserManagement from "./locales/ta-IN/user-management.json";
import taINTags from "./locales/ta-IN/tags.json";
import taINAuditLogs from "./locales/ta-IN/audit-logs.json";
import taINOrgPlans from "./locales/ta-IN/org-plans.json";
import taINMarketplace from "./locales/ta-IN/marketplace.json";
import enUSPersonalDomainBlocklist from "./locales/en-US/personalDomainBlocklist.json";
import deDEPersonalDomainBlocklist from "./locales/de-DE/personalDomainBlocklist.json";
import taINPersonalDomainBlocklist from "./locales/ta-IN/personalDomainBlocklist.json";

import {
	SUPPORTED_LANGUAGES,
	DEFAULT_LANGUAGE,
} from "vetchium-specs/common/common";
import type { SupportedLanguage } from "vetchium-specs/common/common";
export { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE };
export type { SupportedLanguage };

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
		tags: enUSTags,
		auditLogs: enUSAuditLogs,
		orgPlans: enUSOrgPlans,
		marketplace: enUSMarketplace,
		personalDomainBlocklist: enUSPersonalDomainBlocklist,
	},
	"de-DE": {
		common: deDECommon,
		auth: deDEAuth,
		approvedDomains: deDEApprovedDomains,
		userManagement: deDEUserManagement,
		tags: deDETags,
		auditLogs: deDEAuditLogs,
		orgPlans: deDEOrgPlans,
		marketplace: deDEMarketplace,
		personalDomainBlocklist: deDEPersonalDomainBlocklist,
	},
	"ta-IN": {
		common: taINCommon,
		auth: taINAuth,
		approvedDomains: taINApprovedDomains,
		userManagement: taINUserManagement,
		tags: taINTags,
		auditLogs: taINAuditLogs,
		orgPlans: taINOrgPlans,
		marketplace: taINMarketplace,
		personalDomainBlocklist: taINPersonalDomainBlocklist,
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
		"approvedDomains",
		"userManagement",
		"tags",
		"auditLogs",
		"orgPlans",
		"marketplace",
		"personalDomainBlocklist",
	],
	interpolation: {
		escapeValue: false, // React already escapes
	},
});

export default i18n;
