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
import { MyActivityPage } from "./pages/MyActivityPage";
import { MyProfilePage } from "./pages/Profile/MyProfilePage";
import { ProfilePage } from "./pages/Profile/ProfilePage";
import { ConnectionsPage } from "./pages/Connections/ConnectionsPage";
import { EndorsementInboxPage } from "./pages/endorsements/InboxPage";
import { WriteEndorsementPage } from "./pages/endorsements/WritePage";
import { ReferralInboxPage } from "./pages/referrals/ReferralInboxPage";
import { MyApplicationDetailPage } from "./pages/applications/MyApplicationDetailPage";
import { MyApplicationsPage } from "./pages/Hiring/MyApplicationsPage";
import { OpeningsListPage } from "./pages/Openings/OpeningsListPage";
import { OpeningDetailPage } from "./pages/Openings/OpeningDetailPage";
import { ApplyForOpeningPage } from "./pages/Openings/ApplyForOpeningPage";
import { MyCandidaciesPage } from "./pages/Candidacies/MyCandidaciesPage";
import { MyCandidacyDetailPage } from "./pages/Candidacies/MyCandidacyDetailPage";
import { MyInterviewsPage } from "./pages/Candidacies/MyInterviewsPage";
import { ApplyPreferencesPage } from "./pages/Settings/ApplyPreferencesPage";

const { Content } = Layout;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
	const { authState, initializing } = useAuth();
	const location = useLocation();

	if (initializing) return null;

	if (authState === "login") {
		return <Navigate to="/login" state={{ from: location }} replace />;
	}

	if (authState === "tfa") {
		return <Navigate to="/tfa" replace />;
	}

	return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
	const { authState, initializing } = useAuth();

	if (initializing) return null;

	if (authState === "authenticated") {
		return <Navigate to="/" replace />;
	}

	if (authState === "tfa") {
		return <Navigate to="/tfa" replace />;
	}

	return <>{children}</>;
}

function TFARoute({ children }: { children: React.ReactNode }) {
	const { authState, initializing } = useAuth();

	if (initializing) return null;

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
					colorPrimary: "#1677ff",
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
								path="/my-activity"
								element={
									<ProtectedRoute>
										<MyActivityPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/settings/profile"
								element={
									<ProtectedRoute>
										<MyProfilePage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/u/:handle"
								element={
									<ProtectedRoute>
										<ProfilePage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/connections"
								element={
									<ProtectedRoute>
										<ConnectionsPage />
									</ProtectedRoute>
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
							<Route
								path="/endorsement-requests"
								element={
									<ProtectedRoute>
										<EndorsementInboxPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/endorsement-requests/:requestId/write"
								element={
									<ProtectedRoute>
										<WriteEndorsementPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/referrals"
								element={
									<ProtectedRoute>
										<ReferralInboxPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/my-applications"
								element={
									<ProtectedRoute>
										<MyApplicationsPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/my-applications/:applicationId"
								element={
									<ProtectedRoute>
										<MyApplicationDetailPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/openings"
								element={
									<ProtectedRoute>
										<OpeningsListPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/org/:orgDomain/openings/:openingNumber"
								element={
									<ProtectedRoute>
										<OpeningDetailPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/org/:orgDomain/openings/:openingNumber/apply"
								element={
									<ProtectedRoute>
										<ApplyForOpeningPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/my-candidacies"
								element={
									<ProtectedRoute>
										<MyCandidaciesPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/my-candidacies/:candidacyId"
								element={
									<ProtectedRoute>
										<MyCandidacyDetailPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/my-interviews"
								element={
									<ProtectedRoute>
										<MyInterviewsPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/settings/apply-preferences"
								element={
									<ProtectedRoute>
										<ApplyPreferencesPage />
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
