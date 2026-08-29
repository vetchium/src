import { APIErrorAlert as SharedAPIErrorAlert } from "@vetchium/portal-ui/errors";
import {
  IdempotencyKeyConflictError,
  RateLimitExceededError,
} from "typespec/problem/common";
import {
  HubUserDisabledError,
  IncorrectPasswordError,
  IncorrectTOTPCodeError,
  InvalidCredentialsError,
  InvalidLoginChallengeError,
  InvalidPasswordResetTokenError,
  RecentAuthenticationRequiredError,
} from "typespec/problem/hub/authentication";
import {
  InvalidSignupTokenError,
  SignupDomainNotAllowedError,
} from "typespec/problem/hub/signup";
import {
  IncorrectRecoveryCodeError,
  InvalidTOTPEnrollmentError,
  TOTPAlreadyEnabledError,
  TOTPNotEnabledError,
} from "typespec/problem/hub/totp";

// Keyed by the contract constants rather than by the literal type strings, so
// renaming a problem type in TypeSpec fails the build here instead of silently
// falling back to the generic message.
export const problemKeys: Record<string, string> = {
  [InvalidCredentialsError.type]: "errors.invalidCredentials",
  [HubUserDisabledError.type]: "errors.userDisabled",
  [SignupDomainNotAllowedError.type]: "errors.signupDomainNotAllowed",
  [InvalidSignupTokenError.type]: "errors.invalidSignupToken",
  [InvalidPasswordResetTokenError.type]: "errors.invalidResetToken",
  [IncorrectPasswordError.type]: "errors.incorrectPassword",
  [IncorrectTOTPCodeError.type]: "errors.incorrectTOTP",
  [IncorrectRecoveryCodeError.type]: "errors.incorrectRecoveryCode",
  [InvalidLoginChallengeError.type]: "errors.expiredLoginChallenge",
  [RecentAuthenticationRequiredError.type]:
    "errors.recentAuthenticationRequired",
  [RateLimitExceededError.type]: "errors.rateLimited",
  [IdempotencyKeyConflictError.type]: "errors.idempotencyConflict",
  [TOTPAlreadyEnabledError.type]: "errors.totpAlreadyEnabled",
  [TOTPNotEnabledError.type]: "errors.totpNotEnabled",
  [InvalidTOTPEnrollmentError.type]: "errors.invalidEnrollment",
};

export function APIErrorAlert({ error }: { error: unknown }) {
  return (
    <SharedAPIErrorAlert
      error={error}
      problemKeys={problemKeys}
      fallbackKey="errors.generic"
    />
  );
}
