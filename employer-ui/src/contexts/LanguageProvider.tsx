import { useState, useEffect, type ReactNode } from "react";
import { LanguageContext } from "./LanguageContext";
import { getApiBaseUrl } from "../config";
import type {
	SupportedLanguage,
	GetSupportedLanguagesResponse,
} from "vetchium-specs/global/global";
import { DEFAULT_LANGUAGE } from "../i18n";

interface LanguageProviderProps {
	children: ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
	const [languages, setLanguages] = useState<SupportedLanguage[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [defaultLanguage, setDefaultLanguage] =
		useState<string>(DEFAULT_LANGUAGE);

	useEffect(() => {
		async function fetchLanguages() {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(
					`${apiBaseUrl}/global/get-supported-languages`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
					}
				);

				if (response.status === 200) {
					const data: GetSupportedLanguagesResponse = await response.json();
					setLanguages(data.languages);

					// Find and set the default language
					const defaultLang = data.languages.find((lang) => lang.is_default);
					if (defaultLang) {
						setDefaultLanguage(defaultLang.language_code);
					}
				} else {
					setError("Failed to fetch supported languages");
				}
			} catch (err) {
				console.error("Failed to fetch supported languages:", err);
				setError("Failed to fetch supported languages");
			} finally {
				setLoading(false);
			}
		}

		fetchLanguages();
	}, []);

	return (
		<LanguageContext.Provider
			value={{ languages, loading, error, defaultLanguage }}
		>
			{children}
		</LanguageContext.Provider>
	);
}
