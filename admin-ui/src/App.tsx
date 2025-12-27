import { ConfigProvider, Layout, theme as antTheme } from "antd";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AppHeader } from "./components/AppHeader";
import { LoginPage } from "./pages/LoginPage";
import { TFAPage } from "./pages/TFAPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ApprovedDomainsPage } from "./pages/ApprovedDomainsPage";
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	useLocation,
} from "react-router-dom";
import "./i18n";

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
					colorPrimary: "#1890ff",
					// Dark theme improvements
					...(theme === "dark" && {
						colorBgBase: "#1a1a1a",
						colorBgContainer: "#262626",
						colorBgElevated: "#2f2f2f",
						colorBorder: "#434343",
						colorBorderSecondary: "#303030",
						colorText: "rgba(255, 255, 255, 0.88)",
						colorTextSecondary: "rgba(255, 255, 255, 0.65)",
						colorTextTertiary: "rgba(255, 255, 255, 0.45)",
					}),
					// Light theme refinements
					...(theme === "light" && {
						colorBgContainer: "#ffffff",
						colorBgLayout: "#f5f5f5",
						borderRadius: 6,
					}),
				},
			}}
		>
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
						<Route path="*" element={<Navigate to="/" replace />} />
					</Routes>
				</Content>
			</Layout>
		</ConfigProvider>
	);
}

function App() {
	return (
		<BrowserRouter>
			<ThemeProvider>
				<AuthProvider>
					<AppContent />
				</AuthProvider>
			</ThemeProvider>
		</BrowserRouter>
	);
}

export default App;
