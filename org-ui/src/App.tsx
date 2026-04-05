import {
	App as AntApp,
	Button,
	Card,
	ConfigProvider,
	Layout,
	Result,
	Spin,
	theme as antTheme,
	Typography,
} from "antd";
import { I18nextProvider, useTranslation } from "react-i18next";
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
import { DomainManagementPage } from "./pages/DomainManagement/DomainManagementPage";
import { CostCentersPage } from "./pages/CostCenters/CostCentersPage";
import { SubOrgsPage } from "./pages/SubOrgs/SubOrgsPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { MarketplacePage } from "./pages/Marketplace/MarketplacePage";
import { MarketplaceCapabilitiesPage } from "./pages/Marketplace/MarketplaceCapabilitiesPage";
import { MarketplaceCapabilityDetailPage } from "./pages/Marketplace/MarketplaceCapabilityDetailPage";
import { MarketplaceProviderOfferPage } from "./pages/Marketplace/MarketplaceProviderOfferPage";
import { MarketplaceProvideDashboard } from "./pages/Marketplace/MarketplaceProvideDashboard";
import { MarketplaceProvideCapabilityPage } from "./pages/Marketplace/MarketplaceProvideCapabilityPage";
import { MarketplaceProvideApplyPage } from "./pages/Marketplace/MarketplaceProvideApplyPage";
import { MarketplaceProvideOfferPage } from "./pages/Marketplace/MarketplaceProvideOfferPage";
import { MarketplaceProvideOfferEditPage } from "./pages/Marketplace/MarketplaceProvideOfferEditPage";
import { MarketplaceProvideActivityPage } from "./pages/Marketplace/MarketplaceProvideActivityPage";
import { MarketplaceProvideActivityDetailPage } from "./pages/Marketplace/MarketplaceProvideActivityDetailPage";
import { MarketplacePurchasesPage } from "./pages/Marketplace/MarketplacePurchasesPage";
import { MarketplacePurchaseDetailPage } from "./pages/Marketplace/MarketplacePurchaseDetailPage";
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	useLocation,
} from "react-router-dom";
import { NotFoundPage } from "./pages/NotFoundPage";
import { useMyInfo } from "./hooks/useMyInfo";
import i18n from "./i18n";

const { Content } = Layout;
const { Text } = Typography;

function AlreadyLoggedIn() {
	const { t } = useTranslation("auth");
	const { logout, loading } = useAuth();

	return (
		<Card style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
			<Result
				status="info"
				title={t("alreadyLoggedIn.title")}
				subTitle={<Text>{t("alreadyLoggedIn.message")}</Text>}
				extra={
					<Button
						type="primary"
						danger
						loading={loading}
						onClick={logout}
						size="large"
					>
						{t("alreadyLoggedIn.signOutButton")}
					</Button>
				}
			/>
		</Card>
	);
}

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
		return <AlreadyLoggedIn />;
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

function UserManagementRoute({ children }: { children: React.ReactNode }) {
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
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_users") ||
		myInfo?.roles.includes("org:manage_users");

	if (!hasAccess) {
		return <Navigate to="/" replace />;
	}

	return <>{children}</>;
}

function DomainManagementRoute({ children }: { children: React.ReactNode }) {
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

	const hasDomainAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_domains") ||
		myInfo?.roles.includes("org:manage_domains");

	if (!hasDomainAccess) {
		return <Navigate to="/" replace />;
	}

	return <>{children}</>;
}

function CostCentersRoute({ children }: { children: React.ReactNode }) {
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

	const hasCostCentersAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_costcenters") ||
		myInfo?.roles.includes("org:manage_costcenters");

	if (!hasCostCentersAccess) {
		return <Navigate to="/" replace />;
	}

	return <>{children}</>;
}

function MarketplaceProviderRoute({ children }: { children: React.ReactNode }) {
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
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_marketplace") ||
		myInfo?.roles.includes("org:manage_marketplace");

	if (!hasAccess) {
		return <Navigate to="/marketplace" replace />;
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
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_audit_logs");

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
									<UserManagementRoute>
										<UserManagementPage />
									</UserManagementRoute>
								}
							/>
							<Route
								path="/domain-management"
								element={
									<DomainManagementRoute>
										<DomainManagementPage />
									</DomainManagementRoute>
								}
							/>
							<Route
								path="/cost-centers"
								element={
									<CostCentersRoute>
										<CostCentersPage />
									</CostCentersRoute>
								}
							/>
							<Route
								path="/suborgs"
								element={
									<ProtectedRoute>
										<SubOrgsPage />
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
								path="/audit-logs"
								element={
									<AuditLogsRoute>
										<AuditLogsPage />
									</AuditLogsRoute>
								}
							/>
							<Route
								path="/marketplace"
								element={
									<ProtectedRoute>
										<MarketplacePage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/capabilities"
								element={
									<ProtectedRoute>
										<MarketplaceCapabilitiesPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/capabilities/:capability_slug"
								element={
									<ProtectedRoute>
										<MarketplaceCapabilityDetailPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/capabilities/:capability_slug/providers/:provider_org_domain"
								element={
									<ProtectedRoute>
										<MarketplaceProviderOfferPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/provide"
								element={
									<MarketplaceProviderRoute>
										<MarketplaceProvideDashboard />
									</MarketplaceProviderRoute>
								}
							/>
							<Route
								path="/marketplace/provide/:capability_slug"
								element={
									<MarketplaceProviderRoute>
										<MarketplaceProvideCapabilityPage />
									</MarketplaceProviderRoute>
								}
							/>
							<Route
								path="/marketplace/provide/:capability_slug/apply"
								element={
									<MarketplaceProviderRoute>
										<MarketplaceProvideApplyPage />
									</MarketplaceProviderRoute>
								}
							/>
							<Route
								path="/marketplace/provide/:capability_slug/offer"
								element={
									<MarketplaceProviderRoute>
										<MarketplaceProvideOfferPage />
									</MarketplaceProviderRoute>
								}
							/>
							<Route
								path="/marketplace/provide/:capability_slug/offer/edit"
								element={
									<MarketplaceProviderRoute>
										<MarketplaceProvideOfferEditPage />
									</MarketplaceProviderRoute>
								}
							/>
							<Route
								path="/marketplace/provide/:capability_slug/activity"
								element={
									<MarketplaceProviderRoute>
										<MarketplaceProvideActivityPage />
									</MarketplaceProviderRoute>
								}
							/>
							<Route
								path="/marketplace/provide/:capability_slug/activity/:consumer_org_domain"
								element={
									<MarketplaceProviderRoute>
										<MarketplaceProvideActivityDetailPage />
									</MarketplaceProviderRoute>
								}
							/>
							<Route
								path="/marketplace/purchases"
								element={
									<ProtectedRoute>
										<MarketplacePurchasesPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/purchases/from/:provider_org_domain/:capability_slug"
								element={
									<ProtectedRoute>
										<MarketplacePurchaseDetailPage />
									</ProtectedRoute>
								}
							/>
							<Route path="/forgot-password" element={<ForgotPasswordPage />} />
							<Route path="/reset-password" element={<ResetPasswordPage />} />
							<Route
								path="/complete-setup"
								element={
									<AuthRoute>
										<CompleteSetupPage />
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
