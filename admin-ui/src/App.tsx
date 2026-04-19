import {
	App as AntApp,
	ConfigProvider,
	Layout,
	Spin,
	theme as antTheme,
} from "antd";
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
import { ApprovedDomainsPage } from "./pages/ApprovedDomainsPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { CompleteSetupPage } from "./pages/CompleteSetupPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { UserManagementPage } from "./pages/UserManagement/UserManagementPage";
import { ManageTagsPage } from "./pages/ManageTagsPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { OrgSubscriptionsPage } from "./pages/OrgSubscriptions/OrgSubscriptionsPage";
import { CapabilitiesPage } from "./pages/Marketplace/CapabilitiesPage";
import { AdminListingsPage } from "./pages/Marketplace/AdminListingsPage";
import { AdminSubscriptionsPage } from "./pages/Marketplace/AdminSubscriptionsPage";
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	useLocation,
} from "react-router-dom";
import { useMyInfo } from "./hooks/useMyInfo";
import { NotFoundPage } from "./pages/NotFoundPage";
import i18n from "./i18n";

const { Content } = Layout;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
	const { authState, isInitializing } = useAuth();
	const location = useLocation();

	if (isInitializing) {
		return null;
	}

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

function AuditLogsRoute({ children }: { children: React.ReactNode }) {
	const { authState, sessionToken } = useAuth();
	const { data: myInfo, loading } = useMyInfo(sessionToken);
	const location = useLocation();

	if (authState === "login") {
		return <Navigate to="/login" state={{ from: location }} replace />;
	}

	if (authState === "tfa") {
		return <Navigate to="/tfa" replace />;
	}

	if (loading) {
		return <Spin size="large" />;
	}

	const hasAccess =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:view_audit_logs");

	if (!hasAccess) {
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
						colorPrimary: "#722ed1",
					}),
					// Light theme refinements
					...(theme === "light" && {
						colorPrimary: "#722ed1",
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
							<Route
								path="/approved-domains"
								element={
									<ProtectedRoute>
										<ApprovedDomainsPage />
									</ProtectedRoute>
								}
							/>
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
							<Route
								path="/manage-tags"
								element={
									<ProtectedRoute>
										<ManageTagsPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/audit-logs"
								element={
									<AuditLogsRoute>
										<AuditLogsPage />
									</AuditLogsRoute>
								}
							/>
							<Route path="/forgot-password" element={<ForgotPasswordPage />} />
							<Route path="/reset-password" element={<ResetPasswordPage />} />
							<Route path="/complete-setup" element={<CompleteSetupPage />} />
							<Route
								path="/org-subscriptions"
								element={
									<ProtectedRoute>
										<OrgSubscriptionsPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/capabilities"
								element={
									<ProtectedRoute>
										<CapabilitiesPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/listings"
								element={
									<ProtectedRoute>
										<AdminListingsPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/subscriptions"
								element={
									<ProtectedRoute>
										<AdminSubscriptionsPage />
									</ProtectedRoute>
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
