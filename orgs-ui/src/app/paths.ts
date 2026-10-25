import {
  type Capability,
  Sourcing,
} from "typespec/orgs/marketplace/capabilities";

/**
 * Where a Capability's workspace pages live. Every provider page carries its
 * Capability in the path, so a link alone decides the workspace it opens in.
 */
export function capabilityPath(capability: Capability): string {
  return `/${capability.replaceAll("_", "-")}`;
}

const sourcing = capabilityPath(Sourcing);

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
  clients: (capability: Capability) => `${capabilityPath(capability)}/clients`,
  clientEngagementDetail: (capability: Capability, id: string) =>
    `${capabilityPath(capability)}/clients/${encodeURIComponent(id)}`,
  workQueue: (capability: Capability) => `${capabilityPath(capability)}/work`,
  workItem: (capability: Capability, engagementId: string, workId: string) =>
    `${capabilityPath(capability)}/work/${encodeURIComponent(engagementId)}/${encodeURIComponent(workId)}`,
  jobs: `${sourcing}/jobs`,
  jobDetail: (engagementId: string, openingNumber: number) =>
    `${sourcing}/jobs/${encodeURIComponent(engagementId)}/${openingNumber}`,
  contacts: `${sourcing}/contacts`,
  contactDetail: (id: string) =>
    `${sourcing}/contacts/${encodeURIComponent(id)}`,
  newContact: `${sourcing}/contacts/new`,
  creditedApplications: `${sourcing}/credited-applications`,
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
