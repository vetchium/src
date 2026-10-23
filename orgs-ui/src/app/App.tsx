import { Spin } from "antd";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import {
  FulfilEngagements,
  ManageAI,
  ManageBilling,
  ManageListings,
  ManageOpenings,
  ManageProviders,
  ManageUsers,
  Superadmin,
} from "typespec/orgs/authorization/types";
import { AppShell } from "../components/common/AppShell";
import {
  ActiveOrgRoute,
  PermissionRoute,
  ProtectedRoute,
} from "../components/common/ProtectedRoute";
import { PublicShell } from "../components/common/PublicShell";
import { RecentAuthenticationRoute } from "../components/common/RecentAuthenticationRoute";
import { OrganizationSecurityPage } from "../pages/OrganizationSecurityPage";
import { paths } from "./paths";

const AcceptInvitationPage = lazy(() =>
  import("../pages/AcceptInvitationPage").then(({ AcceptInvitationPage }) => ({
    default: AcceptInvitationPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../pages/SettingsPage").then(({ SettingsPage }) => ({
    default: SettingsPage,
  })),
);
const AIPage = lazy(() =>
  import("../pages/AIPage").then(({ AIPage }) => ({
    default: AIPage,
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
const OpeningsPage = lazy(() =>
  import("../pages/OpeningsPage").then(({ OpeningsPage }) => ({
    default: OpeningsPage,
  })),
);
const MyInterviewsPage = lazy(() =>
  import("../pages/MyInterviewsPage").then(({ MyInterviewsPage }) => ({
    default: MyInterviewsPage,
  })),
);
const OpeningDetailPage = lazy(() =>
  import("../pages/OpeningDetailPage").then(({ OpeningDetailPage }) => ({
    default: OpeningDetailPage,
  })),
);
const ApplicationDetailPage = lazy(() =>
  import("../pages/ApplicationDetailPage").then(
    ({ ApplicationDetailPage }) => ({ default: ApplicationDetailPage }),
  ),
);
const OpeningEditorPage = lazy(() =>
  import("../pages/OpeningEditorPage").then(({ OpeningEditorPage }) => ({
    default: OpeningEditorPage,
  })),
);
const PipelineTemplatesPage = lazy(() =>
  import("../pages/PipelineTemplatesPage").then(
    ({ PipelineTemplatesPage }) => ({
      default: PipelineTemplatesPage,
    }),
  ),
);
const FindProvidersPage = lazy(() =>
  import("../pages/FindProvidersPage").then(({ FindProvidersPage }) => ({
    default: FindProvidersPage,
  })),
);
const ListingDetailPage = lazy(() =>
  import("../pages/ListingDetailPage").then(({ ListingDetailPage }) => ({
    default: ListingDetailPage,
  })),
);
const EngagementDetailPage = lazy(() =>
  import("../pages/EngagementDetailPage").then(({ EngagementDetailPage }) => ({
    default: EngagementDetailPage,
  })),
);
const ListingsPage = lazy(() =>
  import("../pages/ListingsPage").then(({ ListingsPage }) => ({
    default: ListingsPage,
  })),
);
const ListingEditorPage = lazy(() =>
  import("../pages/ListingEditorPage").then(({ ListingEditorPage }) => ({
    default: ListingEditorPage,
  })),
);
const ClientsPage = lazy(() =>
  import("../pages/ClientsPage").then(({ ClientsPage }) => ({
    default: ClientsPage,
  })),
);
const ClientEngagementDetailPage = lazy(() =>
  import("../pages/ClientEngagementDetailPage").then(
    ({ ClientEngagementDetailPage }) => ({
      default: ClientEngagementDetailPage,
    }),
  ),
);
const WorkQueuePage = lazy(() =>
  import("../pages/WorkQueuePage").then(({ WorkQueuePage }) => ({
    default: WorkQueuePage,
  })),
);
const WorkItemDetailPage = lazy(() =>
  import("../pages/WorkItemDetailPage").then(({ WorkItemDetailPage }) => ({
    default: WorkItemDetailPage,
  })),
);
const OpeningEditor = lazy(() =>
  import("../features/openings/OpeningEditor").then(({ OpeningEditor }) => ({
    default: OpeningEditor,
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
const GoogleCallbackPage = lazy(() =>
  import("../pages/GoogleCallbackPage").then(({ GoogleCallbackPage }) => ({
    default: GoogleCallbackPage,
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
const TermsPage = lazy(() =>
  import("../pages/TermsPage").then(({ TermsPage }) => ({
    default: TermsPage,
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
          path={paths.signup}
          element={
            <Page>
              <SignupPage />
            </Page>
          }
        />
        <Route
          path={`${paths.signup}/*`}
          element={<Navigate replace to={paths.signup} />}
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
          path={paths.terms}
          element={
            <Page>
              <TermsPage />
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
          path={paths.googleCallback}
          element={
            <Page>
              <GoogleCallbackPage />
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
      <Route
        path="/settings"
        element={<Navigate to={paths.settings} replace />}
      />
      <Route
        path="/security"
        element={<Navigate to={paths.security} replace />}
      />
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
          {/* A suspended Org may read its plan, but cannot change it. */}
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
          <Route element={<ActiveOrgRoute />}>
            <Route
              path={paths.openings}
              element={
                <Page>
                  <OpeningsPage />
                </Page>
              }
            />
            <Route
              path={paths.myInterviews}
              element={
                <Page>
                  <MyInterviewsPage />
                </Page>
              }
            />
            <Route
              path="/openings/:number"
              element={
                <Page>
                  <OpeningDetailPage />
                </Page>
              }
            />
            <Route
              path="/openings/:number/applications/:application"
              element={
                <Page>
                  <ApplicationDetailPage />
                </Page>
              }
            />
            <Route element={<PermissionRoute permission={ManageOpenings} />}>
              <Route
                path={paths.newOpening}
                element={
                  <Page>
                    <OpeningEditor />
                  </Page>
                }
              />
              <Route
                path="/openings/:number/edit"
                element={
                  <Page>
                    <OpeningEditorPage />
                  </Page>
                }
              />
            </Route>
            <Route element={<PermissionRoute permission={ManageOpenings} />}>
              <Route
                path={paths.pipelineTemplates}
                element={
                  <Page>
                    <PipelineTemplatesPage />
                  </Page>
                }
              />
            </Route>
            <Route element={<PermissionRoute permission={ManageProviders} />}>
              <Route
                path={paths.findProviders}
                element={
                  <Page>
                    <FindProvidersPage />
                  </Page>
                }
              />
              <Route
                path="/providers/listings/:domain/:capability"
                element={
                  <Page>
                    <ListingDetailPage />
                  </Page>
                }
              />
              <Route
                path="/providers/engagements/:id"
                element={
                  <Page>
                    <EngagementDetailPage />
                  </Page>
                }
              />
            </Route>
            <Route element={<PermissionRoute permission={ManageListings} />}>
              <Route
                path={paths.listings}
                element={
                  <Page>
                    <ListingsPage />
                  </Page>
                }
              />
              <Route
                path="/listings/:capability"
                element={
                  <Page>
                    <ListingEditorPage />
                  </Page>
                }
              />
              <Route
                path={paths.clients}
                element={
                  <Page>
                    <ClientsPage />
                  </Page>
                }
              />
              <Route
                path="/clients/:id"
                element={
                  <Page>
                    <ClientEngagementDetailPage />
                  </Page>
                }
              />
            </Route>
            <Route element={<PermissionRoute permission={FulfilEngagements} />}>
              <Route
                path={paths.workQueue}
                element={
                  <Page>
                    <WorkQueuePage />
                  </Page>
                }
              />
              <Route
                path="/work/:engagementId/:workId"
                element={
                  <Page>
                    <WorkItemDetailPage />
                  </Page>
                }
              />
            </Route>
            <Route element={<PermissionRoute permission={Superadmin} />}>
              <Route
                path={paths.organizationSecurity}
                element={
                  <Page>
                    <OrganizationSecurityPage />
                  </Page>
                }
              />
              <Route
                path={paths.settings}
                element={
                  <Page>
                    <SettingsPage />
                  </Page>
                }
              />
            </Route>
            <Route element={<PermissionRoute permission={ManageAI} />}>
              <Route
                path={paths.ai}
                element={
                  <Page>
                    <AIPage />
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
