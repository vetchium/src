import {
  APIErrorAlert as SharedAPIErrorAlert,
  problemTranslationKey as sharedProblemTranslationKey,
} from "@vetchium/portal-ui/errors";
import {
  IdempotencyKeyConflictError,
  RateLimitExceededError,
} from "typespec/problem/common";
import { ValidationFailedError } from "typespec/problem/details";
import {
  IncorrectPasswordError,
  IncorrectTOTPCodeError,
  InvalidCredentialsError,
  InvalidLoginChallengeError,
  InvalidPasswordResetTokenError,
  OrgUserDisabledError,
  PermissionRequiredError,
  RecentAuthenticationRequiredError,
} from "typespec/problem/orgs/authentication";
import {
  DirectoryUnavailableError,
  DNSRecordNotFoundError,
  DomainAlreadyOwnedError,
  InvalidSignupTokenError,
  SignupDomainBlockedError,
  SignupUnavailableError,
} from "typespec/problem/orgs/signup";
import {
  IncorrectRecoveryCodeError,
  InvalidTOTPEnrollmentError,
  TOTPAlreadyEnabledError,
  TOTPNotEnabledError,
} from "typespec/problem/orgs/totp";

// Keyed by the contract constants rather than by the literal type strings, so
// renaming a problem type in TypeSpec fails the build here instead of silently
// falling back to the generic message.
export const problemKeys: Readonly<Record<string, string>> = {
  [ValidationFailedError.type]: "errors.validationFailed",
  [RateLimitExceededError.type]: "errors.rateLimited",
  [IdempotencyKeyConflictError.type]: "errors.idempotencyConflict",
  [SignupUnavailableError.type]: "errors.signupUnavailable",
  [SignupDomainBlockedError.type]: "errors.signupDomainBlocked",
  [DomainAlreadyOwnedError.type]: "errors.domainAlreadyOwned",
  [InvalidSignupTokenError.type]: "errors.invalidSignupToken",
  [DNSRecordNotFoundError.type]: "errors.dnsRecordNotFound",
  [DirectoryUnavailableError.type]: "errors.directoryUnavailable",
  [InvalidCredentialsError.type]: "errors.invalidCredentials",
  [OrgUserDisabledError.type]: "errors.userDisabled",
  [IncorrectPasswordError.type]: "errors.incorrectPassword",
  [InvalidLoginChallengeError.type]: "errors.expiredLoginChallenge",
  [IncorrectTOTPCodeError.type]: "errors.incorrectTOTP",
  [IncorrectRecoveryCodeError.type]: "errors.incorrectRecoveryCode",
  [InvalidPasswordResetTokenError.type]: "errors.invalidResetToken",
  [PermissionRequiredError.type]: "errors.permissionRequired",
  [RecentAuthenticationRequiredError.type]:
    "errors.recentAuthenticationRequired",
  [TOTPAlreadyEnabledError.type]: "errors.totpAlreadyEnabled",
  [TOTPNotEnabledError.type]: "errors.totpNotEnabled",
  [InvalidTOTPEnrollmentError.type]: "errors.invalidEnrollment",
};

export const fallbackProblemKey = "errors.generic";

export function problemTranslationKey(error: unknown): string {
  return sharedProblemTranslationKey(error, problemKeys, fallbackProblemKey);
}

export function APIErrorAlert({ error }: { error: unknown }) {
  return (
    <SharedAPIErrorAlert
      error={error}
      problemKeys={problemKeys}
      fallbackKey={fallbackProblemKey}
    />
  );
}
