import { ConfigProvider, Layout, theme as antTheme } from "antd";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AppHeader } from "./components/AppHeader";
import { LoginPage } from "./pages/LoginPage";
import { TFAPage } from "./pages/TFAPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ApprovedDomainsPage } from "./pages/ApprovedDomainsPage";
import { useState } from "react";
import "./i18n";

const { Content } = Layout;

type Page = "dashboard" | "approved-domains";

function AppContent() {
	const { theme } = useTheme();
	const { authState } = useAuth();
	const [currentPage, setCurrentPage] = useState<Page>("dashboard");

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
					{authState === "authenticated" && currentPage === "dashboard" && (
						<DashboardPage onNavigate={(page) => setCurrentPage(page)} />
					)}
					{authState === "authenticated" &&
						currentPage === "approved-domains" && (
							<ApprovedDomainsPage onBack={() => setCurrentPage("dashboard")} />
						)}
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
