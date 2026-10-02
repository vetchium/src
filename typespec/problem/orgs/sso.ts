import type { Details } from "../details.ts";

export const SSOSignInFailedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-sso-sign-in-failed",
  title: "Sign-in failed",
  status: 401,
  detail: "The sign-in could not be completed",
};

export const SSONotAvailableError: Readonly<Details> = {
  type: "vetchium-problem-details/org-sso-not-available",
  title: "Single sign-on not available",
  status: 404,
  detail: "Google sign-in is not available in this region",
};
