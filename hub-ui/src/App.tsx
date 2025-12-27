import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider, theme as antTheme } from "antd";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import i18n from "./lib/i18n";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { SignupVerifyPage } from "./pages/SignupVerifyPage";

function AppContent() {
	const { theme } = useTheme();

	return (
		<ConfigProvider
			theme={{
				algorithm:
					theme === "dark" ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
				token: {
					// Dark theme improvements
					...(theme === "dark" && {
						colorPrimary: "#52c41a",
					}),
					// Light theme refinements
					...(theme === "light" && {
						colorPrimary: "#52c41a",
					}),
				},
			}}
		>
			<Routes>
				<Route path="/" element={<HomePage />} />
				<Route path="/login" element={<LoginPage />} />
				<Route path="/signup" element={<SignupPage />} />
				<Route path="/signup/verify" element={<SignupVerifyPage />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</ConfigProvider>
	);
}

function App() {
	return (
		<I18nextProvider i18n={i18n}>
			<ThemeProvider>
				<AuthProvider>
					<BrowserRouter>
						<AppContent />
					</BrowserRouter>
				</AuthProvider>
			</ThemeProvider>
		</I18nextProvider>
	);
}

export default App;
