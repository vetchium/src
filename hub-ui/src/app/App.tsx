import { Spin } from "antd";
import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { AppShell } from "../components/common/AppShell";
import { ProtectedRoute } from "../components/common/ProtectedRoute";
import { PublicShell } from "../components/common/PublicShell";
import { RecentAuthenticationRoute } from "../components/common/RecentAuthenticationRoute";

const ApplicationDetailPage = lazy(() =>
  import("../pages/ApplicationDetailPage").then(
    ({ ApplicationDetailPage }) => ({
      default: ApplicationDetailPage,
    }),
  ),
);
const ApplicationsPage = lazy(() =>
  import("../pages/ApplicationsPage").then(({ ApplicationsPage }) => ({
    default: ApplicationsPage,
  })),
);
const ApplyPage = lazy(() =>
  import("../pages/ApplyPage").then(({ ApplyPage }) => ({
    default: ApplyPage,
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
const MessagesPage = lazy(() =>
  import("../pages/MessagesPage").then(({ MessagesPage }) => ({
    default: MessagesPage,
  })),
);
const OrgPage = lazy(() =>
  import("../pages/OrgPage").then(({ OrgPage }) => ({ default: OrgPage })),
);
const OrgOpeningPage = lazy(() =>
  import("../pages/OrgOpeningPage").then(({ OrgOpeningPage }) => ({
    default: OrgOpeningPage,
  })),
);
const NotFoundPage = lazy(() =>
  import("../pages/NotFoundPage").then(({ NotFoundPage }) => ({
    default: NotFoundPage,
  })),
);
const PlanPage = lazy(() =>
  import("../pages/PlanPage").then(({ PlanPage }) => ({
    default: PlanPage,
  })),
);
const PreferencesPage = lazy(() =>
  import("../pages/PreferencesPage").then(({ PreferencesPage }) => ({
    default: PreferencesPage,
  })),
);
const ProfilePage = lazy(() =>
  import("../pages/ProfilePage").then(({ ProfilePage }) => ({
    default: ProfilePage,
  })),
);
const ProfileViewPage = lazy(() =>
  import("../pages/ProfileViewPage").then(({ ProfileViewPage }) => ({
    default: ProfileViewPage,
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
const TermsPage = lazy(() =>
  import("../pages/TermsPage").then(({ TermsPage }) => ({
    default: TermsPage,
  })),
);
const WorkEmailsPage = lazy(() =>
  import("../pages/WorkEmailsPage").then(({ WorkEmailsPage }) => ({
    default: WorkEmailsPage,
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
          path="signup/:residentCountry?/:language?/:step?"
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
        <Route
          path="terms"
          element={
            <Page>
              <TermsPage />
            </Page>
          }
        />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<PublicShell />}>
          <Route
            path="reauthenticate"
            element={
              <Page>
                <ReauthenticatePage />
              </Page>
            }
          />
        </Route>
        <Route element={<AppShell />}>
          <Route
            path="org/:domain"
            element={
              <Page>
                <OrgPage />
              </Page>
            }
          />
          <Route
            path="org/:domain/openings/:number"
            element={
              <Page>
                <OrgOpeningPage />
              </Page>
            }
          />
          <Route
            path="org/:domain/openings/:number/apply"
            element={
              <Page>
                <ApplyPage />
              </Page>
            }
          />
          <Route
            path="applications"
            element={
              <Page>
                <ApplicationsPage />
              </Page>
            }
          />
          <Route
            path="applications/:domain/:openingNumber/:applicationNumber"
            element={
              <Page>
                <ApplicationDetailPage />
              </Page>
            }
          />
          <Route
            path="messages"
            element={
              <Page>
                <MessagesPage />
              </Page>
            }
          />
          <Route
            path="messages/:contactId"
            element={
              <Page>
                <MessagesPage />
              </Page>
            }
          />
          <Route
            index
            element={
              <Page>
                <HomePage />
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
            path="settings/preferences"
            element={
              <Page>
                <PreferencesPage />
              </Page>
            }
          />
          <Route
            path="settings/work-emails"
            element={
              <Page>
                <WorkEmailsPage />
              </Page>
            }
          />
          <Route
            path="u/:address"
            element={
              <Page>
                <ProfileViewPage />
              </Page>
            }
          />
          <Route
            path="plan"
            element={
              <Page>
                <PlanPage />
              </Page>
            }
          />
          <Route element={<RecentAuthenticationRoute />}>
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
