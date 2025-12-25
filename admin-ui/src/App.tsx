import { ConfigProvider, Layout, theme as antTheme } from "antd";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AppHeader } from "./components/AppHeader";
import { LoginPage } from "./pages/LoginPage";
import { TFAPage } from "./pages/TFAPage";
import { DashboardPage } from "./pages/DashboardPage";
import "./i18n";

const { Content } = Layout;

function AppContent() {
	const { theme } = useTheme();
	const { authState } = useAuth();

	return (
		<ConfigProvider
			theme={{
				algorithm:
					theme === "dark" ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
				token: {
					colorPrimary: "#1890ff",
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
					{authState === "login" && <LoginPage />}
					{authState === "tfa" && <TFAPage />}
					{authState === "authenticated" && <DashboardPage />}
				</Content>
			</Layout>
		</ConfigProvider>
	);
}

function App() {
	return (
		<ThemeProvider>
			<AuthProvider>
				<AppContent />
			</AuthProvider>
		</ThemeProvider>
	);
}

export default App;
