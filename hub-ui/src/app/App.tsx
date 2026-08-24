import { Spin } from "antd";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { AppShell } from "../components/common/AppShell";
import { ProtectedRoute } from "../components/common/ProtectedRoute";
import { PublicShell } from "../components/common/PublicShell";

const HomePage = lazy(() =>
  import("../pages/HomePage").then(({ HomePage }) => ({ default: HomePage })),
);
const LoginPage = lazy(() =>
  import("../pages/LoginPage").then(({ LoginPage }) => ({
    default: LoginPage,
  })),
);
const SignupPage = lazy(() =>
  import("../pages/SignupPage").then(({ SignupPage }) => ({
    default: SignupPage,
  })),
);
const CompleteSignupPage = lazy(() =>
  import("../pages/CompleteSignupPage").then(({ CompleteSignupPage }) => ({
    default: CompleteSignupPage,
  })),
);
const ForgotPasswordPage = lazy(() =>
  import("../pages/ForgotPasswordPage").then(({ ForgotPasswordPage }) => ({
    default: ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import("../pages/ResetPasswordPage").then(({ ResetPasswordPage }) => ({
    default: ResetPasswordPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../pages/SettingsPage").then(({ SettingsPage }) => ({
    default: SettingsPage,
  })),
);

function Page({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Spin fullscreen size="large" />}>{children}</Suspense>
  );
}

function EntryRoute() {
  const { authenticated } = useAuth();
  return <Navigate to={authenticated ? "/" : "/login"} replace />;
}

function LoginRoute() {
  const { authenticated } = useAuth();
  return authenticated ? (
    <Navigate to="/" replace />
  ) : (
    <Page>
      <LoginPage />
    </Page>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route path="login" element={<LoginRoute />} />
        <Route
          path="signup"
          element={
            <Page>
              <SignupPage />
            </Page>
          }
        />
        <Route
          path="complete-signup"
          element={
            <Page>
              <CompleteSignupPage />
            </Page>
          }
        />
        <Route
          path="forgot-password"
          element={
            <Page>
              <ForgotPasswordPage />
            </Page>
          }
        />
        <Route
          path="reset-password"
          element={
            <Page>
              <ResetPasswordPage />
            </Page>
          }
        />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route
            index
            element={
              <Page>
                <HomePage />
              </Page>
            }
          />
          <Route
            path="settings"
            element={
              <Page>
                <SettingsPage />
              </Page>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<EntryRoute />} />
    </Routes>
  );
}
