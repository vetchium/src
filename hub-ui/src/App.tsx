import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	useLocation,
} from "react-router-dom";
import { NotFoundPage } from "./pages/NotFoundPage";

import { App as AntApp, ConfigProvider, Layout, theme as antTheme } from "antd";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "./contexts/ThemeProvider";
import { useTheme } from "./hooks/useTheme";
import { AuthProvider } from "./contexts/AuthProvider";
import { useAuth } from "./hooks/useAuth";
import { LanguageProvider } from "./contexts/LanguageProvider";
import { AppHeader } from "./components/AppHeader";
import i18n from "./i18n";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { SignupVerifyPage } from "./pages/SignupVerifyPage";
import { TFAPage } from "./pages/TFAPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { ChangeEmailPage } from "./pages/ChangeEmailPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";

const { Content } = Layout;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
	const { authState } = useAuth();
	const location = useLocation();

	if (authState === "login") {
		return <Navigate to="/login" state={{ from: location }} replace />;
	}

	if (authState === "tfa") {
		return <Navigate to="/tfa" replace />;
	}

	return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
	const { authState } = useAuth();

	if (authState === "authenticated") {
		return <Navigate to="/" replace />;
	}

	if (authState === "tfa") {
		return <Navigate to="/tfa" replace />;
	}

	return <>{children}</>;
}

function TFARoute({ children }: { children: React.ReactNode }) {
	const { authState } = useAuth();

	if (authState === "login") {
		return <Navigate to="/login" replace />;
	}

	if (authState === "authenticated") {
		return <Navigate to="/" replace />;
	}

	return <>{children}</>;
}

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
			<AntApp>
				<Layout style={{ minHeight: "100vh" }}>
					<AppHeader />
					<Content
						style={{
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							flex: 1,
						}}
					>
						<Routes>
							<Route
								path="/"
								element={
									<ProtectedRoute>
										<HomePage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/login"
								element={
									<AuthRoute>
										<LoginPage />
									</AuthRoute>
								}
							/>
							<Route path="/forgot-password" element={<ForgotPasswordPage />} />
							<Route path="/reset-password" element={<ResetPasswordPage />} />
							<Route
								path="/change-password"
								element={
									<ProtectedRoute>
										<ChangePasswordPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/change-email"
								element={
									<ProtectedRoute>
										<ChangeEmailPage />
									</ProtectedRoute>
								}
							/>
							<Route path="/verify-email" element={<VerifyEmailPage />} />
							<Route
								path="/tfa"
								element={
									<TFARoute>
										<TFAPage />
									</TFARoute>
								}
							/>
							<Route
								path="/signup"
								element={
									<AuthRoute>
										<SignupPage />
									</AuthRoute>
								}
							/>
							<Route
								path="/signup/verify"
								element={
									<AuthRoute>
										<SignupVerifyPage />
									</AuthRoute>
								}
							/>
							<Route path="*" element={<NotFoundPage />} />
						</Routes>
					</Content>
				</Layout>
			</AntApp>
		</ConfigProvider>
	);
}

function App() {
	return (
		<I18nextProvider i18n={i18n}>
			<LanguageProvider>
				<ThemeProvider>
					<AuthProvider>
						<BrowserRouter>
							<AppContent />
						</BrowserRouter>
					</AuthProvider>
				</ThemeProvider>
			</LanguageProvider>
		</I18nextProvider>
	);
}

export default App;
