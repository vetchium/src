import "../details.tsp";
import "./authentication.tsp";

namespace Vetchium.Problem;

const TOTPAlreadyEnabledError = #{
  type: "vetchium-problem-details/totp-already-enabled",
  title: "TOTP already enabled",
  status: 409,
  detail: "The admin user already has confirmed TOTP",
};

alias TOTPAlreadyEnabledErrorResponse = Response<
  409,
  typeof TOTPAlreadyEnabledError
>;

const InvalidTOTPEnrollmentError = #{
  type: "vetchium-problem-details/invalid-totp-enrollment",
  title: "Invalid TOTP enrollment",
  status: 409,
  detail: "TOTP enrollment is invalid, expired, consumed, or belongs to another user",
};

alias InvalidTOTPEnrollmentErrorResponse = Response<
  409,
  typeof InvalidTOTPEnrollmentError
>;

const IncorrectRecoveryCodeError = #{
  type: "vetchium-problem-details/incorrect-recovery-code",
  title: "Incorrect recovery code",
  status: 422,
  detail: "The recovery code is incorrect, consumed, or unavailable",
};

alias IncorrectRecoveryCodeErrorResponse = Response<
  422,
  typeof IncorrectRecoveryCodeError
>;

const TOTPNotEnabledError = #{
  type: "vetchium-problem-details/totp-not-enabled",
  title: "TOTP not enabled",
  status: 409,
  detail: "The admin user does not have confirmed TOTP",
};

alias TOTPNotEnabledErrorResponse = Response<409, typeof TOTPNotEnabledError>;
