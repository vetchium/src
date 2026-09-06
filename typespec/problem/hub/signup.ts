import type { Details } from "../details.ts";

export const SignupDomainNotAllowedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-signup-domain-not-allowed",
  title: "Hub signup domain not allowed",
  status: 403,
  detail: "This tenant does not allow Hub signup with that email domain",
};

export const InvalidSignupTokenError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-invalid-signup-token",
  title: "Invalid Hub signup token",
  status: 401,
  detail: "Signup token is invalid, expired, consumed, or no longer eligible",
};

export const SignupUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-signup-unavailable",
  title: "Hub signup unavailable",
  status: 403,
  detail:
    "This region is not accepting signup for your resident country. Choose another region.",
};
