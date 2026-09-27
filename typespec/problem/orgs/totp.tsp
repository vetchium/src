import "../details.tsp";

namespace Vetchium.Problem;

const OrgTOTPAlreadyEnabledError = #{
  type: "vetchium-problem-details/org-totp-already-enabled",
  title: "TOTP already enabled",
  status: 409,
  detail: "The Org user already has confirmed TOTP",
};
alias OrgTOTPAlreadyEnabledErrorResponse = Response<
  409,
  typeof OrgTOTPAlreadyEnabledError
>;

const InvalidOrgTOTPEnrollmentError = #{
  type: "vetchium-problem-details/org-invalid-totp-enrollment",
  title: "Invalid TOTP enrollment",
  status: 409,
  detail: "TOTP enrollment is invalid, expired, consumed, or belongs to another user",
};
alias InvalidOrgTOTPEnrollmentErrorResponse = Response<
  409,
  typeof InvalidOrgTOTPEnrollmentError
>;

const IncorrectOrgRecoveryCodeError = #{
  type: "vetchium-problem-details/org-incorrect-recovery-code",
  title: "Incorrect recovery code",
  status: 422,
  detail: "The recovery code is incorrect, consumed, or unavailable",
};
alias IncorrectOrgRecoveryCodeErrorResponse = Response<
  422,
  typeof IncorrectOrgRecoveryCodeError
>;

const OrgTOTPNotEnabledError = #{
  type: "vetchium-problem-details/org-totp-not-enabled",
  title: "TOTP not enabled",
  status: 409,
  detail: "The Org user does not have confirmed TOTP",
};
alias OrgTOTPNotEnabledErrorResponse = Response<
  409,
  typeof OrgTOTPNotEnabledError
>;
