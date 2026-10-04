import type { Details } from "../details.ts";

export const SignupUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/org-signup-unavailable",
  title: "Org signup unavailable",
  status: 403,
  detail: "This region is not accepting Org signup. Choose another region.",
};

export const SignupDomainBlockedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-signup-domain-blocked",
  title: "Org signup domain blocked",
  status: 403,
  detail: "This domain cannot be used for Org signup",
};

export const DomainAlreadyOwnedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-domain-already-owned",
  title: "Org domain already owned",
  status: 409,
  detail: "Another Org already owns this domain",
};

export const InvalidSignupTokenError: Readonly<Details> = {
  type: "vetchium-problem-details/org-invalid-signup-token",
  title: "Invalid Org signup token",
  status: 401,
  detail: "Signup token is invalid, expired, consumed, or no longer eligible",
};

export const DNSRecordNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-dns-record-not-found",
  title: "Domain verification record not found",
  status: 422,
  detail:
    "The domain verification TXT record was not found. Publish it and try again.",
};

export const DirectoryUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/org-directory-unavailable",
  title: "Global directory unavailable",
  status: 503,
  detail: "Domain ownership cannot be checked right now. Try again later.",
};
