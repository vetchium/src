import "../details.tsp";

namespace Vetchium.Problem;

const InvalidOrgCredentialsError = #{
  type: "vetchium-problem-details/org-invalid-credentials",
  title: "Invalid Org credentials",
  status: 401,
  detail: "The supplied credentials are invalid",
};
alias InvalidOrgCredentialsErrorResponse = AuthenticationResponse<
  "VetchiumLogin realm=\"orgs\"",
  typeof InvalidOrgCredentialsError
>;

const IncorrectOrgPasswordError = #{
  type: "vetchium-problem-details/org-incorrect-password",
  title: "Incorrect password",
  status: 422,
  detail: "The password did not verify for the authenticated Org user",
};
alias IncorrectOrgPasswordErrorResponse = Response<
  422,
  typeof IncorrectOrgPasswordError
>;

const OrgUserDisabledError = #{
  type: "vetchium-problem-details/org-user-disabled",
  title: "Org user disabled",
  status: 403,
  detail: "The Org user is disabled",
};
alias OrgUserDisabledErrorResponse = Response<403, typeof OrgUserDisabledError>;

const OrgAuthenticationRequiredError = #{
  type: "vetchium-problem-details/org-authentication-required",
  title: "Org authentication required",
  status: 401,
  detail: "A valid Org bearer session is required",
};
alias OrgAuthenticationRequiredErrorResponse = AuthenticationResponse<
  "Bearer realm=\"orgs\"",
  typeof OrgAuthenticationRequiredError
>;

const InvalidOrgLoginChallengeError = #{
  type: "vetchium-problem-details/org-invalid-login-challenge",
  title: "Invalid Org login challenge",
  status: 401,
  detail: "Login challenge is invalid, expired, or consumed",
};
alias InvalidOrgLoginChallengeErrorResponse = AuthenticationResponse<
  "VetchiumLoginChallenge realm=\"orgs\"",
  typeof InvalidOrgLoginChallengeError
>;

const IncorrectOrgTOTPCodeError = #{
  type: "vetchium-problem-details/org-incorrect-totp-code",
  title: "Incorrect TOTP code",
  status: 422,
  detail: "The TOTP code did not verify",
};
alias IncorrectOrgTOTPCodeErrorResponse = Response<
  422,
  typeof IncorrectOrgTOTPCodeError
>;

const InvalidOrgPasswordResetTokenError = #{
  type: "vetchium-problem-details/org-invalid-password-reset-token",
  title: "Invalid password reset token",
  status: 401,
  detail: "Password reset token is invalid, expired, consumed, or no longer eligible",
};
alias InvalidOrgPasswordResetTokenErrorResponse = AuthenticationResponse<
  "VetchiumPasswordReset realm=\"orgs\"",
  typeof InvalidOrgPasswordResetTokenError
>;

const OrgPermissionRequiredError = #{
  type: "vetchium-problem-details/org-permission-required",
  title: "Org permission required",
  status: 403,
  detail: "The Org user lacks the permission this operation requires",
};
alias OrgPermissionRequiredErrorResponse = Response<
  403,
  typeof OrgPermissionRequiredError
>;

const OrgRecentAuthenticationRequiredError = #{
  type: "vetchium-problem-details/org-recent-authentication-required",
  title: "Recent authentication required",
  status: 401,
  detail: "Full authentication must have completed within the preceding five minutes",
};
union OrgAuthenticationOrRecentRequiredErrorBody {
  authenticationRequired: typeof OrgAuthenticationRequiredError,
  recentAuthenticationRequired: typeof OrgRecentAuthenticationRequiredError,
}
alias OrgAuthenticationOrRecentRequiredErrorResponse = AuthenticationResponse<
  "Bearer realm=\"orgs\"",
  OrgAuthenticationOrRecentRequiredErrorBody
>;

/** The Org owning the domain is homed in another tenant. The client offers to
 * continue at that tenant's Org portal. */
model OrgHomedElsewhereDetails {
  type: "vetchium-problem-details/org-homed-elsewhere";
  title: "Org homed in another region";
  status: 409;
  detail: "This Org signs in at another region's Org portal";
  tenant_id: string;
  orgs_url: url;
  instance?: string;
}

alias OrgHomedElsewhereErrorResponse = Response<409, OrgHomedElsewhereDetails>;
