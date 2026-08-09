import type { Details } from "../details.ts";

export const TOTPAlreadyEnabledError: Readonly<Details> = {
  type: "vetchium-problem-details/totp-already-enabled",
  title: "TOTP already enabled",
  status: 409,
  detail: "The admin user already has confirmed TOTP",
};

export const InvalidTOTPEnrollmentError: Readonly<Details> = {
  type: "vetchium-problem-details/invalid-totp-enrollment",
  title: "Invalid TOTP enrollment",
  status: 409,
  detail:
    "TOTP enrollment is invalid, expired, consumed, or belongs to another user",
};

export const IncorrectRecoveryCodeError: Readonly<Details> = {
  type: "vetchium-problem-details/incorrect-recovery-code",
  title: "Incorrect recovery code",
  status: 422,
  detail: "The recovery code is incorrect, consumed, or unavailable",
};

export const TOTPNotEnabledError: Readonly<Details> = {
  type: "vetchium-problem-details/totp-not-enabled",
  title: "TOTP not enabled",
  status: 409,
  detail: "The admin user does not have confirmed TOTP",
};
