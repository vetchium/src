import "../details.tsp";

namespace Vetchium.Problem;

const OrgSignupUnavailableError = #{
  type: "vetchium-problem-details/org-signup-unavailable",
  title: "Org signup unavailable",
  status: 403,
  detail: "This region is not accepting Org signup. Choose another region.",
};
alias OrgSignupUnavailableErrorResponse = Response<
  403,
  typeof OrgSignupUnavailableError
>;

const OrgSignupDomainBlockedError = #{
  type: "vetchium-problem-details/org-signup-domain-blocked",
  title: "Org signup domain blocked",
  status: 403,
  detail: "This domain cannot be used for Org signup",
};
alias OrgSignupDomainBlockedErrorResponse = Response<
  403,
  typeof OrgSignupDomainBlockedError
>;

const OrgDomainAlreadyOwnedError = #{
  type: "vetchium-problem-details/org-domain-already-owned",
  title: "Org domain already owned",
  status: 409,
  detail: "Another Org already owns this domain",
};
alias OrgDomainAlreadyOwnedErrorResponse = Response<
  409,
  typeof OrgDomainAlreadyOwnedError
>;

const InvalidOrgSignupTokenError = #{
  type: "vetchium-problem-details/org-invalid-signup-token",
  title: "Invalid Org signup token",
  status: 401,
  detail: "Signup token is invalid, expired, consumed, or no longer eligible",
};
alias InvalidOrgSignupTokenErrorResponse = AuthenticationResponse<
  "VetchiumSignup realm=\"orgs\"",
  typeof InvalidOrgSignupTokenError
>;

const OrgDNSRecordNotFoundError = #{
  type: "vetchium-problem-details/org-dns-record-not-found",
  title: "Domain verification record not found",
  status: 422,
  detail: "The domain verification TXT record was not found. Publish it and try again.",
};
alias OrgDNSRecordNotFoundErrorResponse = Response<
  422,
  typeof OrgDNSRecordNotFoundError
>;

const OrgDirectoryUnavailableError = #{
  type: "vetchium-problem-details/org-directory-unavailable",
  title: "Global directory unavailable",
  status: 503,
  detail: "Domain ownership cannot be checked right now. Try again later.",
};
alias OrgDirectoryUnavailableErrorResponse = Response<
  503,
  typeof OrgDirectoryUnavailableError
>;
