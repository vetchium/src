import {
	Alert,
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
import { UsersPage } from "./pages/Users/UsersPage";
import { DomainsPage } from "./pages/Domains/DomainsPage";
import { CostCentersPage } from "./pages/CostCenters/CostCentersPage";
import { AddressesPage } from "./pages/Addresses/AddressesPage";
import { SubOrgsPage } from "./pages/SubOrgs/SubOrgsPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { PlanPage } from "./pages/Plan/PlanPage";
import { MarketplaceDiscoverPage } from "./pages/Marketplace/MarketplaceDiscoverPage";
import { MyListingsPage } from "./pages/Marketplace/MyListingsPage";
import { CreateListingPage } from "./pages/Marketplace/CreateListingPage";
import { MarketplaceListingPage } from "./pages/Marketplace/MarketplaceListingPage";
import { EditListingPage } from "./pages/Marketplace/EditListingPage";
import { MySubscriptionsPage } from "./pages/Marketplace/MySubscriptionsPage";
import { SubscriptionDetailPage } from "./pages/Marketplace/SubscriptionDetailPage";
import { MyClientsPage } from "./pages/Marketplace/MyClientsPage";
import OpeningsListPage from "./pages/Openings/OpeningsListPage";
import CreateOpeningPage from "./pages/Openings/CreateOpeningPage";
import OpeningDetailPage from "./pages/Openings/OpeningDetailPage";
import EditOpeningPage from "./pages/Openings/EditOpeningPage";
import {
	BrowserRouter,
	Link,
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

function AddressesRoute({ children }: { children: React.ReactNode }) {
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

	const hasAddressesAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_addresses") ||
		myInfo?.roles.includes("org:manage_addresses");

	if (!hasAddressesAccess) {
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
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_audit_logs");

	if (!hasAccess) {
		return <Navigate to="/" replace />;
	}

	return <>{children}</>;
}

function FailingDomainsWarning() {
	const { t } = useTranslation("auth");
	const { authState, sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);

	if (authState !== "authenticated" || !myInfo?.has_failing_domains) {
		return null;
	}

	return (
		<Alert
			type="warning"
			banner
			title={
				<>
					{t("domain.failingDomainsWarning")}{" "}
					<Link to="/domains">{t("domainManagement.title")}</Link>
				</>
			}
		/>
	);
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
					<FailingDomainsWarning />
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
								path="/users"
								element={
									<UserManagementRoute>
										<UsersPage />
									</UserManagementRoute>
								}
							/>
							<Route
								path="/domains"
								element={
									<DomainManagementRoute>
										<DomainsPage />
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
								path="/settings/addresses"
								element={
									<AddressesRoute>
										<AddressesPage />
									</AddressesRoute>
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
							<Route
								path="/settings/plan"
								element={
									<ProtectedRoute>
										<PlanPage />
									</ProtectedRoute>
								}
							/>
							{/* Job Openings — literal routes first, then pattern routes */}
							<Route
								path="/openings"
								element={
									<ProtectedRoute>
										<OpeningsListPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/openings/new"
								element={
									<ProtectedRoute>
										<CreateOpeningPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/openings/:openingNumber/edit"
								element={
									<ProtectedRoute>
										<EditOpeningPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/openings/:openingNumber"
								element={
									<ProtectedRoute>
										<OpeningDetailPage />
									</ProtectedRoute>
								}
							/>
							{/* Marketplace — literal routes first, then pattern routes */}
							<Route
								path="/marketplace"
								element={
									<ProtectedRoute>
										<MarketplaceDiscoverPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/listings"
								element={
									<ProtectedRoute>
										<MyListingsPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/listings/new"
								element={
									<ProtectedRoute>
										<CreateListingPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/subscriptions"
								element={
									<ProtectedRoute>
										<MySubscriptionsPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/clients"
								element={
									<ProtectedRoute>
										<MyClientsPage />
									</ProtectedRoute>
								}
							/>
							{/* Pattern routes after literal routes */}
							<Route
								path="/marketplace/listings/:orgDomain/:listingNumber/edit"
								element={
									<ProtectedRoute>
										<EditListingPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/listings/:orgDomain/:listingNumber"
								element={
									<ProtectedRoute>
										<MarketplaceListingPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/marketplace/subscriptions/:providerOrgDomain/:listingNumber"
								element={
									<ProtectedRoute>
										<SubscriptionDetailPage />
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
