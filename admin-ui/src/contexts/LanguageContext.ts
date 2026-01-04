import { createContext } from "react";
import type { SupportedLanguage } from "vetchium-specs/global/global";

export interface LanguageContextType {
	languages: SupportedLanguage[];
	loading: boolean;
	error: string | null;
	defaultLanguage: string;
}

export const LanguageContext = createContext<LanguageContextType | undefined>(
	undefined
);
