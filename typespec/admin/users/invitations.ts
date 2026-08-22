import type { NewPassword, OpaqueToken } from "../../common/authentication.ts";
import { isNewPassword, isOpaqueToken } from "../../common/authentication.ts";
import type { EmailAddress } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";
import type { DisplayName, FrontendLocale } from "../../common/localization.ts";
import {
  isDisplayName,
  isFrontendLocale,
  normalizeDisplayName,
} from "../../common/localization.ts";
import {
  type AdminPermissionID,
  validatePermissions,
} from "../authorization/types.ts";
import { type AdminUserID, isAdminUserID } from "../types.ts";

export type AdminInvitationID = string;
export type AdminInvitationToken = OpaqueToken;

export function isAdminInvitationID(value: AdminInvitationID): boolean {
  return isAdminUserID(value);
}

export interface InviteUserRequest {
  email_address: EmailAddress;
  permissions?: AdminPermissionID[];
}

export function normalizeInviteUserRequest(
  request: InviteUserRequest,
): InviteUserRequest {
  return {
    ...request,
    email_address: normalizeEmailAddress(request.email_address),
  };
}

export function validateInviteUserRequest(
  request: InviteUserRequest,
): string[] {
  const fields: string[] = [];
  if (!isEmailAddress(normalizeInviteUserRequest(request).email_address)) {
    fields.push("email_address");
  }
  if (
    request.permissions !== undefined &&
    !validatePermissions(request.permissions)
  ) {
    fields.push("permissions");
  }
  return fields;
}

export interface InviteUserResponse {
  admin_invitation_id: AdminInvitationID;
  expires_at: string;
}

export interface CompleteSetupRequest {
  invitation_token: AdminInvitationToken;
  password: NewPassword;
  display_name: DisplayName;
  preferred_language: FrontendLocale;
}

export function normalizeCompleteSetupRequest(
  request: CompleteSetupRequest,
): CompleteSetupRequest {
  return {
    ...request,
    display_name: normalizeDisplayName(request.display_name),
  };
}

export function validateCompleteSetupRequest(
  request: CompleteSetupRequest,
): string[] {
  const normalized = normalizeCompleteSetupRequest(request);
  const fields: string[] = [];
  if (!isOpaqueToken(normalized.invitation_token)) {
    fields.push("invitation_token");
  }
  if (!isNewPassword(normalized.password)) {
    fields.push("password");
  }
  if (!isDisplayName(normalized.display_name)) {
    fields.push("display_name");
  }
  if (!isFrontendLocale(normalized.preferred_language)) {
    fields.push("preferred_language");
  }
  return fields;
}

export interface CompleteSetupResponse {
  admin_user_id: AdminUserID;
}
