import { Spin } from "antd";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { AppShell } from "../components/common/AppShell";
import {
  ActiveOrgRoute,
  ProtectedRoute,
} from "../components/common/ProtectedRoute";
import { PublicShell } from "../components/common/PublicShell";
import { paths } from "./paths";

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
const HomePage = lazy(() =>
  import("../pages/HomePage").then(({ HomePage }) => ({ default: HomePage })),
);
const LandingPage = lazy(() =>
  import("../pages/LandingPage").then(({ LandingPage }) => ({
    default: LandingPage,
  })),
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
const ReauthenticatePage = lazy(() =>
  import("../pages/ReauthenticatePage").then(({ ReauthenticatePage }) => ({
    default: ReauthenticatePage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import("../pages/ResetPasswordPage").then(({ ResetPasswordPage }) => ({
    default: ResetPasswordPage,
  })),
);
const RestoreDomainPage = lazy(() =>
  import("../pages/RestoreDomainPage").then(({ RestoreDomainPage }) => ({
    default: RestoreDomainPage,
  })),
);
const SecurityPage = lazy(() =>
  import("../pages/SecurityPage").then(({ SecurityPage }) => ({
    default: SecurityPage,
  })),
);
const SignupPage = lazy(() =>
  import("../pages/SignupPage").then(({ SignupPage }) => ({
    default: SignupPage,
  })),
);
const TwoFactorPage = lazy(() =>
  import("../pages/TwoFactorPage").then(({ TwoFactorPage }) => ({
    default: TwoFactorPage,
  })),
);

function Page({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Spin fullscreen size="large" />}>{children}</Suspense>
  );
}

function Landing() {
  const { authenticated } = useAuth();
  if (authenticated) return <Navigate replace to={paths.home} />;
  return (
    <Page>
      <LandingPage />
    </Page>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route index element={<Landing />} />
        <Route
          path={paths.signup}
          element={
            <Page>
              <SignupPage />
            </Page>
          }
        />
        <Route
          path={paths.completeSignup}
          element={
            <Page>
              <CompleteSignupPage />
            </Page>
          }
        />
        <Route
          path={paths.login}
          element={
            <Page>
              <LoginPage />
            </Page>
          }
        />
        <Route
          path={paths.twoFactor}
          element={
            <Page>
              <TwoFactorPage />
            </Page>
          }
        />
        <Route
          path={paths.forgotPassword}
          element={
            <Page>
              <ForgotPasswordPage />
            </Page>
          }
        />
        <Route
          path={paths.resetPassword}
          element={
            <Page>
              <ResetPasswordPage />
            </Page>
          }
        />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<PublicShell />}>
          <Route
            path={paths.reauthenticate}
            element={
              <Page>
                <ReauthenticatePage />
              </Page>
            }
          />
        </Route>
        <Route element={<AppShell />}>
          <Route
            path={paths.security}
            element={
              <Page>
                <SecurityPage />
              </Page>
            }
          />
          <Route
            path={paths.restoreDomain}
            element={
              <Page>
                <RestoreDomainPage />
              </Page>
            }
          />
          <Route element={<ActiveOrgRoute />}>
            <Route
              path={paths.home}
              element={
                <Page>
                  <HomePage />
                </Page>
              }
            />
          </Route>
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
