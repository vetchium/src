import { APIErrorAlert as SharedAPIErrorAlert } from "@vetchium/portal-ui/errors";
import {
  IdempotencyKeyConflictError,
  RateLimitExceededError,
} from "typespec/problem/common";
import {
  ApplicationExistsError,
  ApplicationNotFoundError,
  ApplicationStateConflictError,
  OpeningNotAcceptingError,
} from "typespec/problem/hub/applications";
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
  HubAgencyNotAssignedError,
  HubChatRequestBlockedError,
  HubChatRequestExistsError,
  HubChatRequestLimitReachedError,
  HubChatRequestNotFoundError,
  HubConversationClosedError,
  HubConversationNotFoundError,
  HubConversationOpenError,
  HubConversationPartyDeletedError,
} from "typespec/problem/hub/conversations";
import {
  EmailAddressUnavailableError,
  EmailChangeCodeRejectedError,
  EmailChangeInProgressError,
  EmailChangeUnavailableError,
} from "typespec/problem/hub/email";
import { OrgUnavailableError } from "typespec/problem/hub/openings";
import {
  ProfessionalEmailCodeRejectedError,
  ProfileConflictError,
  ProfileNotFoundError,
  ProfilePictureInvalidError,
  ProfilePictureTooLargeError,
  ProfileUnavailableError,
} from "typespec/problem/hub/profile";
import {
  InvalidSignupTokenError,
  SignupDomainNotAllowedError,
  SignupUnavailableError,
} from "typespec/problem/hub/signup";
import {
  PlanNotOfferedError,
  PlanRequiredErrorType,
} from "typespec/problem/hub/subscriptions";
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
  [SignupUnavailableError.type]: "errors.signupUnavailable",
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
  [PlanNotOfferedError.type]: "errors.planNotOffered",
  [ProfileNotFoundError.type]: "errors.profileNotFound",
  [ProfileUnavailableError.type]: "errors.profileUnavailable",
  [ProfileConflictError.type]: "errors.profileConflict",
  [ProfessionalEmailCodeRejectedError.type]:
    "errors.professionalEmailCodeRejected",
  [ProfilePictureTooLargeError.type]: "errors.profilePictureTooLarge",
  [ProfilePictureInvalidError.type]: "errors.profilePictureInvalid",
  [PlanRequiredErrorType]: "errors.planRequired",
  [EmailChangeCodeRejectedError.type]: "errors.emailChangeCodeRejected",
  [EmailAddressUnavailableError.type]: "errors.emailAddressUnavailable",
  [EmailChangeInProgressError.type]: "errors.emailChangeInProgress",
  [EmailChangeUnavailableError.type]: "errors.emailChangeUnavailable",
  [ApplicationExistsError.type]: "errors.applicationExists",
  [OpeningNotAcceptingError.type]: "errors.openingNotAccepting",
  [ApplicationNotFoundError.type]: "errors.applicationNotFound",
  [ApplicationStateConflictError.type]: "errors.applicationStateConflict",
  [OrgUnavailableError.type]: "errors.orgUnavailable",
  [HubConversationNotFoundError.type]: "errors.conversationNotFound",
  [HubConversationPartyDeletedError.type]: "errors.conversationPartyDeleted",
  [HubChatRequestLimitReachedError.type]: "errors.chatRequestLimitReached",
  [HubChatRequestExistsError.type]: "errors.chatRequestExists",
  [HubChatRequestBlockedError.type]: "errors.chatRequestBlocked",
  [HubChatRequestNotFoundError.type]: "errors.chatRequestNotFound",
  [HubConversationOpenError.type]: "errors.conversationOpen",
  [HubConversationClosedError.type]: "errors.conversationClosed",
  [HubAgencyNotAssignedError.type]: "errors.agencyNotAssigned",
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
