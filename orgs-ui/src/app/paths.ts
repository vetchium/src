export const paths = {
  home: "/",
  signup: "/signup",
  completeSignup: "/complete-signup",
  login: "/login",
  twoFactor: "/login/two-factor",
  googleCallback: "/sso/google/callback",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  reauthenticate: "/reauthenticate",
  security: "/account",
  restoreDomain: "/restore-domain",
  members: "/members",
  openings: "/openings",
  newOpening: "/openings/new",
  openingDetail: (number: number) => `/openings/${number}`,
  openingEdit: (number: number) => `/openings/${number}/edit`,
  application: (opening: number, application: number) =>
    `/openings/${opening}/applications/${application}`,
  myInterviews: "/my-interviews",
  pipelineTemplates: "/pipeline-templates",
  findProviders: "/providers",
  listingDetail: (domain: string, capability: string) =>
    `/providers/listings/${encodeURIComponent(domain)}/${encodeURIComponent(capability)}`,
  engagementDetail: (id: string) => `/providers/engagements/${id}`,
  listings: "/listings",
  listingEditor: (capability: string) =>
    `/listings/${encodeURIComponent(capability)}`,
  clients: "/clients",
  clientEngagementDetail: (id: string) => `/clients/${encodeURIComponent(id)}`,
  workQueue: "/work",
  workItem: (engagementId: string, workId: string) =>
    `/work/${encodeURIComponent(engagementId)}/${encodeURIComponent(workId)}`,
  plans: "/plans",
  ai: "/ai",
  settings: "/company",
  organizationSecurity: "/organization-security",
  acceptInvitation: "/accept-invitation",
  terms: "/terms",
} as const;

/** Sign-in with the Org domain prefilled, as emailed links and completed
 * signups use it. */
export function loginPath(domain?: string): string {
  return domain === undefined || domain === ""
    ? paths.login
    : `${paths.login}?domain=${encodeURIComponent(domain)}`;
}
