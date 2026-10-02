export const paths = {
  home: "/",
  signup: "/signup",
  completeSignup: "/complete-signup",
  login: "/login",
  twoFactor: "/login/two-factor",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  reauthenticate: "/reauthenticate",
  security: "/security",
  restoreDomain: "/restore-domain",
  members: "/members",
  acceptInvitation: "/accept-invitation",
} as const;

/** Sign-in with the Org domain prefilled, as emailed links and completed
 * signups use it. */
export function loginPath(domain?: string): string {
  return domain === undefined || domain === ""
    ? paths.login
    : `${paths.login}?domain=${encodeURIComponent(domain)}`;
}
