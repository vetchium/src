import { useState, useEffect, type ReactNode } from "react";
import { ThemeContext, type ThemeMode } from "./ThemeContext";

const THEME_STORAGE_KEY = "vetchium_employer_theme";

function getStoredTheme(): ThemeMode {
	const stored = localStorage.getItem(THEME_STORAGE_KEY);
	if (stored === "light" || stored === "dark") {
		return stored;
	}

	// Check system preference
	if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
		return "dark";
	}

	return "light";
}

function setStoredTheme(theme: ThemeMode): void {
	localStorage.setItem(THEME_STORAGE_KEY, theme);
}

interface ThemeProviderProps {
	children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
	const [theme, setThemeState] = useState<ThemeMode>(getStoredTheme);

	useEffect(() => {
		// Listen for system theme changes
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = (e: MediaQueryListEvent) => {
			// Only update if no stored preference
			if (!localStorage.getItem(THEME_STORAGE_KEY)) {
				setThemeState(e.matches ? "dark" : "light");
			}
		};

		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, []);

	const setTheme = (newTheme: ThemeMode) => {
		setThemeState(newTheme);
		setStoredTheme(newTheme);
	};

	const toggleTheme = () => {
		setTheme(theme === "light" ? "dark" : "light");
	};

	return (
		<ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}
