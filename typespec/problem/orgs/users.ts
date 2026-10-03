import type { Details } from "../details.ts";

export interface UserLimitReachedDetails extends Details {
  type: "vetchium-problem-details/org-user-limit-reached";
  limit: number;
}

export const UserLimitReachedErrorType =
  "vetchium-problem-details/org-user-limit-reached";

export function isUserLimitReachedProblem(
  value: unknown,
): value is UserLimitReachedDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === UserLimitReachedErrorType &&
    typeof (value as { limit?: unknown }).limit === "number"
  );
}

export const InvitationInvalidError: Readonly<Details> = {
  type: "vetchium-problem-details/org-invitation-invalid",
  title: "Invalid Org invitation",
  status: 401,
  detail: "Invitation token is invalid, expired, consumed, or cancelled",
};

export const InvitationNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-invitation-not-found",
  title: "Org invitation not found",
  status: 404,
  detail: "No pending invitation exists for an address in the request",
};

export const UserAlreadyExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/org-user-already-exists",
  title: "Org user already exists",
  status: 409,
  detail: "An Org user already exists for the invited address",
};

export interface UserNotFoundDetails extends Details {
  type: "vetchium-problem-details/org-user-not-found";
  email_address: string;
}

export const UserNotFoundErrorType =
  "vetchium-problem-details/org-user-not-found";

export function isUserNotFoundProblem(
  value: unknown,
): value is UserNotFoundDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === UserNotFoundErrorType &&
    typeof (value as { email_address?: unknown }).email_address === "string"
  );
}

export const SelfChangeForbiddenError: Readonly<Details> = {
  type: "vetchium-problem-details/org-self-change-forbidden",
  title: "Org user cannot change itself",
  status: 409,
  detail: "An Org user cannot disable itself or change its own permissions",
};

export const LastSuperadminError: Readonly<Details> = {
  type: "vetchium-problem-details/org-last-superadmin",
  title: "Last Org superadmin",
  status: 409,
  detail: "At least one active Org user must keep org:superadmin",
};

export interface SuperadminRequiredDetails extends Details {
  type: "vetchium-problem-details/org-superadmin-required";
  email_address: string;
}

export const SuperadminRequiredErrorType =
  "vetchium-problem-details/org-superadmin-required";

export function isSuperadminRequiredProblem(
  value: unknown,
): value is SuperadminRequiredDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === SuperadminRequiredErrorType &&
    typeof (value as { email_address?: unknown }).email_address === "string"
  );
}
