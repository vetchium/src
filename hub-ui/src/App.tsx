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
          colorPrimary: "#531dab",
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
