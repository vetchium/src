import { Spin } from "antd";
import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { ManageBilling, ManageUsers } from "typespec/orgs/authorization/types";
import { AppShell } from "../components/common/AppShell";
import {
  ActiveOrgRoute,
  PermissionRoute,
  ProtectedRoute,
} from "../components/common/ProtectedRoute";
import { PublicShell } from "../components/common/PublicShell";
import { RecentAuthenticationRoute } from "../components/common/RecentAuthenticationRoute";
import { paths } from "./paths";

const AcceptInvitationPage = lazy(() =>
  import("../pages/AcceptInvitationPage").then(({ AcceptInvitationPage }) => ({
    default: AcceptInvitationPage,
  })),
);
const PlansPage = lazy(() =>
  import("../pages/PlansPage").then(({ PlansPage }) => ({
    default: PlansPage,
  })),
);
const MembersPage = lazy(() =>
  import("../pages/MembersPage").then(({ MembersPage }) => ({
    default: MembersPage,
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

export function App() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route
          path={`${paths.signup}/:country?/:language?/:step?`}
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
          path={paths.acceptInvitation}
          element={
            <Page>
              <AcceptInvitationPage />
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
          <Route element={<RecentAuthenticationRoute />}>
            <Route
              path={paths.security}
              element={
                <Page>
                  <SecurityPage />
                </Page>
              }
            />
          </Route>
          <Route
            path={paths.restoreDomain}
            element={
              <Page>
                <RestoreDomainPage />
              </Page>
            }
          />
          <Route element={<ActiveOrgRoute />}>
            <Route element={<PermissionRoute permission={ManageBilling} />}>
              <Route
                path={paths.plans}
                element={
                  <Page>
                    <PlansPage />
                  </Page>
                }
              />
            </Route>
            <Route element={<PermissionRoute permission={ManageUsers} />}>
              <Route
                path={paths.members}
                element={
                  <Page>
                    <MembersPage />
                  </Page>
                }
              />
            </Route>
            <Route
              index
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
