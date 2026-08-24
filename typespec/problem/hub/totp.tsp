import "../details.tsp";

namespace Vetchium.Problem;

const HubTOTPAlreadyEnabledError = #{
  type: "vetchium-problem-details/hub-totp-already-enabled",
  title: "TOTP already enabled",
  status: 409,
  detail: "The Hub user already has confirmed TOTP",
};
alias HubTOTPAlreadyEnabledErrorResponse = Response<
  409,
  typeof HubTOTPAlreadyEnabledError
>;

const InvalidHubTOTPEnrollmentError = #{
  type: "vetchium-problem-details/hub-invalid-totp-enrollment",
  title: "Invalid TOTP enrollment",
  status: 409,
  detail: "TOTP enrollment is invalid, expired, consumed, or belongs to another user",
};
alias InvalidHubTOTPEnrollmentErrorResponse = Response<
  409,
  typeof InvalidHubTOTPEnrollmentError
>;

const IncorrectHubRecoveryCodeError = #{
  type: "vetchium-problem-details/hub-incorrect-recovery-code",
  title: "Incorrect recovery code",
  status: 422,
  detail: "The recovery code is incorrect, consumed, or unavailable",
};
alias IncorrectHubRecoveryCodeErrorResponse = Response<
  422,
  typeof IncorrectHubRecoveryCodeError
>;

const HubTOTPNotEnabledError = #{
  type: "vetchium-problem-details/hub-totp-not-enabled",
  title: "TOTP not enabled",
  status: 409,
  detail: "The Hub user does not have confirmed TOTP",
};
alias HubTOTPNotEnabledErrorResponse = Response<
  409,
  typeof HubTOTPNotEnabledError
>;
