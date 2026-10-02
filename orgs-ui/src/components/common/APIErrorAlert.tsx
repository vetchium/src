import { problemTranslationKey as sharedProblemTranslationKey } from "@vetchium/portal-ui/errors";
import { Alert } from "antd";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
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
  OrgUserDisabledNonpaymentError,
  PermissionRequiredError,
  RecentAuthenticationRequiredError,
} from "typespec/problem/orgs/authentication";
import {
  BillingPastDueError,
  InvoiceNotOpenError,
  isUserLimitExceedsTargetProblem,
  PaymentDeclinedError,
  PaymentMethodRequiredError,
  PlanNotOfferedError,
} from "typespec/problem/orgs/billing";
import {
  LogoConflictError,
  LogoInvalidError,
  LogoTooLargeError,
} from "typespec/problem/orgs/logo";
import {
  DirectoryUnavailableError,
  DNSRecordNotFoundError,
  DomainAlreadyOwnedError,
  InvalidSignupTokenError,
  SignupDomainBlockedError,
  SignupUnavailableError,
} from "typespec/problem/orgs/signup";
import { OrgSuspendedError } from "typespec/problem/orgs/suspension";
import {
  IncorrectRecoveryCodeError,
  InvalidTOTPEnrollmentError,
  TOTPAlreadyEnabledError,
  TOTPNotEnabledError,
} from "typespec/problem/orgs/totp";
import {
  InvitationInvalidError,
  InvitationNotFoundError,
  isSuperadminRequiredProblem,
  isUserLimitReachedProblem,
  isUserNotFoundProblem,
  LastSuperadminError,
  SelfChangeForbiddenError,
  UserAlreadyExistsError,
} from "typespec/problem/orgs/users";

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
  [OrgUserDisabledNonpaymentError.type]: "errors.userDisabledNonpayment",
  [InvitationInvalidError.type]: "errors.invalidInvitation",
  [InvitationNotFoundError.type]: "errors.invitationNotFound",
  [UserAlreadyExistsError.type]: "errors.userAlreadyExists",
  [SelfChangeForbiddenError.type]: "errors.selfChange",
  [LastSuperadminError.type]: "errors.lastSuperadmin",
  [PlanNotOfferedError.type]: "errors.planNotOffered",
  [BillingPastDueError.type]: "errors.billingPastDue",
  [PaymentMethodRequiredError.type]: "errors.paymentMethodRequired",
  [PaymentDeclinedError.type]: "errors.paymentDeclined",
  [InvoiceNotOpenError.type]: "errors.invoiceNotOpen",
  [OrgSuspendedError.type]: "errors.orgSuspended",
  [LogoInvalidError.type]: "errors.logoInvalid",
  [LogoTooLargeError.type]: "errors.logoTooLarge",
  [LogoConflictError.type]: "errors.logoConflict",
  "vetchium-problem-details/org-plan-required": "errors.planRequired",
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

/**
 * The message for a problem. A few problems carry the address or the cap they
 * refer to, which the message names; the rest map to a fixed message.
 */
export function problemMessage(t: TFunction, error: unknown): string {
  const problem =
    error instanceof Error && "problem" in error
      ? (error as { problem?: unknown }).problem
      : undefined;
  if (isUserNotFoundProblem(problem)) {
    return t("errors.userNotFound", { email: problem.email_address });
  }
  if (isSuperadminRequiredProblem(problem)) {
    return t("errors.superadminRequired", { email: problem.email_address });
  }
  if (isUserLimitExceedsTargetProblem(problem)) {
    return t("errors.userLimitExceedsTarget", {
      limit: problem.limit,
      seats: problem.seats_in_use,
    });
  }
  if (isUserLimitReachedProblem(problem)) {
    return t("errors.userLimitReached", { limit: problem.limit });
  }
  return t(problemTranslationKey(error));
}

export function APIErrorAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (error === null || error === undefined) return null;
  return <Alert type="error" showIcon title={problemMessage(t, error)} />;
}
