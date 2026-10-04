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
  plans: "/plans",
  settings: "/company",
  organizationSecurity: "/organization-security",
  acceptInvitation: "/accept-invitation",
} as const;

/** Sign-in with the Org domain prefilled, as emailed links and completed
 * signups use it. */
export function loginPath(domain?: string): string {
  return domain === undefined || domain === ""
    ? paths.login
    : `${paths.login}?domain=${encodeURIComponent(domain)}`;
}
