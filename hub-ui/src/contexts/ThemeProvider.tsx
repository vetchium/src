
import { useState, useEffect } from "react";
import { ThemeContext, type Theme } from "./ThemeContext";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setTheme] = useState<Theme>(() => {
		// Get theme from localStorage or default to light
		const stored = localStorage.getItem("vetchium_hub_theme");
		return (stored as Theme) || "light";
	});

	useEffect(() => {
		// Save theme to localStorage whenever it changes
		localStorage.setItem("vetchium_hub_theme", theme);
	}, [theme]);

	const toggleTheme = () => {
		setTheme((prev) => (prev === "light" ? "dark" : "light"));
	};

	return (
		<ThemeContext.Provider value={{ theme, toggleTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}


