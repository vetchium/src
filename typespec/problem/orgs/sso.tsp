import "../details.tsp";

namespace Vetchium.Problem;

const OrgSSOSignInFailedError = #{
  type: "vetchium-problem-details/org-sso-sign-in-failed",
  title: "Sign-in failed",
  status: 401,
  detail: "The sign-in could not be completed",
};
alias OrgSSOSignInFailedErrorResponse = AuthenticationResponse<
  "VetchiumLogin realm=\"orgs\"",
  typeof OrgSSOSignInFailedError
>;

const OrgSSONotAvailableError = #{
  type: "vetchium-problem-details/org-sso-not-available",
  title: "Single sign-on not available",
  status: 404,
  detail: "Google sign-in is not available in this region",
};
alias OrgSSONotAvailableErrorResponse = Response<
  404,
  typeof OrgSSONotAvailableError
>;
