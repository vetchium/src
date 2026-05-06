import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Import translations
import enUSCommon from "./locales/en-US/common.json";
import enUSAuth from "./locales/en-US/auth.json";
import enUSSignup from "./locales/en-US/signup.json";
import enUSAuditLogs from "./locales/en-US/audit-logs.json";
import enUSProfile from "./locales/en-US/profile.json";
import enUSWorkEmails from "./locales/en-US/workEmails.json";
import deDECommon from "./locales/de-DE/common.json";
import deDEAuth from "./locales/de-DE/auth.json";
import deDESignup from "./locales/de-DE/signup.json";
import deDEAuditLogs from "./locales/de-DE/audit-logs.json";
import deDEProfile from "./locales/de-DE/profile.json";
import deDEWorkEmails from "./locales/de-DE/workEmails.json";
import taINCommon from "./locales/ta-IN/common.json";
import taINAuth from "./locales/ta-IN/auth.json";
import taINSignup from "./locales/ta-IN/signup.json";
import taINAuditLogs from "./locales/ta-IN/audit-logs.json";
import taINProfile from "./locales/ta-IN/profile.json";
import taINWorkEmails from "./locales/ta-IN/workEmails.json";

import {
	SUPPORTED_LANGUAGES,
	DEFAULT_LANGUAGE,
} from "vetchium-specs/common/common";
import type { SupportedLanguage } from "vetchium-specs/common/common";
export { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE };
export type { SupportedLanguage };

const LANGUAGE_STORAGE_KEY = "vetchium_hub_language";

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
		signup: enUSSignup,
		auditLogs: enUSAuditLogs,
		profile: enUSProfile,
		workEmails: enUSWorkEmails,
	},
	"de-DE": {
		common: deDECommon,
		auth: deDEAuth,
		signup: deDESignup,
		auditLogs: deDEAuditLogs,
		profile: deDEProfile,
		workEmails: deDEWorkEmails,
	},
	"ta-IN": {
		common: taINCommon,
		auth: taINAuth,
		signup: taINSignup,
		auditLogs: taINAuditLogs,
		profile: taINProfile,
		workEmails: taINWorkEmails,
	},
};

i18n.use(initReactI18next).init({
	resources,
	lng: getStoredLanguage(),
	fallbackLng: DEFAULT_LANGUAGE,
	defaultNS: "common",
	ns: ["common", "auth", "signup", "auditLogs", "profile", "workEmails"],
	interpolation: {
		escapeValue: false, // React already escapes
	},
});

export default i18n;
