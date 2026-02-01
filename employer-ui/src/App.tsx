import { App as AntApp, ConfigProvider, Layout, theme as antTheme } from "antd";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "./contexts/ThemeProvider";
import { useTheme } from "./hooks/useTheme";
import { AuthProvider } from "./contexts/AuthProvider";
import { useAuth } from "./hooks/useAuth";
import { LanguageProvider } from "./contexts/LanguageProvider";
import { AppHeader } from "./components/AppHeader";
import { LoginPage } from "./pages/LoginPage";
import { TFAPage } from "./pages/TFAPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SignupPage } from "./pages/SignupPage";
import { SignupCompletePage } from "./pages/SignupCompletePage";
import { EULAPage } from "./pages/EULAPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { CompleteSetupPage } from "./pages/CompleteSetupPage";
import { UserManagementPage } from "./pages/UserManagement/UserManagementPage";
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	useLocation,
} from "react-router-dom";
import { NotFoundPage } from "./pages/NotFoundPage";
import i18n from "./i18n";

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
						colorPrimary: "#1890ff",
					}),
					// Light theme refinements
					...(theme === "light" && {
						colorPrimary: "#1890ff",
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
								path="/login"
								element={
									<AuthRoute>
										<LoginPage />
									</AuthRoute>
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
								path="/complete-signup"
								element={
									<AuthRoute>
										<SignupCompletePage />
									</AuthRoute>
								}
							/>
							<Route
								path="/tfa"
								element={
									<TFARoute>
										<TFAPage />
									</TFARoute>
								}
							/>
							<Route
								path="/"
								element={
									<ProtectedRoute>
										<DashboardPage />
									</ProtectedRoute>
								}
							/>
							<Route path="/eula" element={<EULAPage />} />
							<Route
								path="/user-management"
								element={
									<ProtectedRoute>
										<UserManagementPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/change-password"
								element={
									<ProtectedRoute>
										<ChangePasswordPage />
									</ProtectedRoute>
								}
							/>
							<Route path="/forgot-password" element={<ForgotPasswordPage />} />
							<Route path="/reset-password" element={<ResetPasswordPage />} />
							<Route path="/complete-setup" element={<CompleteSetupPage />} />
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
