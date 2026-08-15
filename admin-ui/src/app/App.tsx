import { Spin } from "antd";
import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { AppShell } from "../components/common/AppShell";
import { ProtectedRoute } from "../components/common/ProtectedRoute";
import { PublicShell } from "../components/common/PublicShell";

const CompleteSetupPage = lazy(() =>
  import("../pages/CompleteSetupPage").then(({ CompleteSetupPage }) => ({
    default: CompleteSetupPage,
  })),
);
const ForgotPasswordPage = lazy(() =>
  import("../pages/ForgotPasswordPage").then(({ ForgotPasswordPage }) => ({
    default: ForgotPasswordPage,
  })),
);
const HomePage = lazy(() =>
  import("../pages/HomePage").then(({ HomePage }) => ({ default: HomePage })),
);
const LoginPage = lazy(() =>
  import("../pages/LoginPage").then(({ LoginPage }) => ({
    default: LoginPage,
  })),
);
const NotFoundPage = lazy(() =>
  import("../pages/NotFoundPage").then(({ NotFoundPage }) => ({
    default: NotFoundPage,
  })),
);
const ProfilePage = lazy(() =>
  import("../pages/ProfilePage").then(({ ProfilePage }) => ({
    default: ProfilePage,
  })),
);
const SecurityPage = lazy(() =>
  import("../pages/SecurityPage").then(({ SecurityPage }) => ({
    default: SecurityPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import("../pages/ResetPasswordPage").then(({ ResetPasswordPage }) => ({
    default: ResetPasswordPage,
  })),
);
const TwoFactorPage = lazy(() =>
  import("../pages/TwoFactorPage").then(({ TwoFactorPage }) => ({
    default: TwoFactorPage,
  })),
);
const UsersPage = lazy(() =>
  import("../pages/UsersPage").then(({ UsersPage }) => ({
    default: UsersPage,
  })),
);

function Page({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Spin fullscreen size="large" />}>{children}</Suspense>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route
          path="login"
          element={
            <Page>
              <LoginPage />
            </Page>
          }
        />
        <Route
          path="login/two-factor"
          element={
            <Page>
              <TwoFactorPage />
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
        <Route
          path="complete-setup"
          element={
            <Page>
              <CompleteSetupPage />
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
            path="users"
            element={
              <Page>
                <UsersPage />
              </Page>
            }
          />
          <Route
            path="settings/profile"
            element={
              <Page>
                <ProfilePage />
              </Page>
            }
          />
          <Route
            path="settings/security"
            element={
              <Page>
                <SecurityPage />
              </Page>
            }
          />
        </Route>
      </Route>
      <Route element={<PublicShell />}>
        <Route
          path="*"
          element={
            <Page>
              <NotFoundPage />
            </Page>
          }
        />
      </Route>
    </Routes>
  );
}
