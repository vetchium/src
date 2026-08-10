import type { NewPassword, OpaqueToken } from "../../common/authentication.ts";
import { isNewPassword, isOpaqueToken } from "../../common/authentication.ts";
import type { EmailAddress } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";
import type {
  LanguageCode,
  LocalizedDisplayName,
  RegionalLanguageCode,
  TimeZoneID,
} from "../../common/localization.ts";
import { isLanguageCode, isTimeZoneID } from "../../common/localization.ts";
import { type AdminUserID, isAdminUserID } from "../types.ts";
import { normalizeDisplayNames, validateDisplayNames } from "./validation.ts";

export type AdminInvitationID = string;
export type AdminInvitationToken = OpaqueToken;

export function isAdminInvitationID(value: AdminInvitationID): boolean {
  return isAdminUserID(value);
}

export interface InviteUserRequest {
  email_address: EmailAddress;
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
  return isEmailAddress(normalizeInviteUserRequest(request).email_address)
    ? []
    : ["email_address"];
}

export interface InviteUserResponse {
  admin_invitation_id: AdminInvitationID;
  expires_at: string;
}

export interface CompleteSetupRequest {
  invitation_token: AdminInvitationToken;
  password: NewPassword;
  display_names: LocalizedDisplayName[];
  primary_display_name_language: RegionalLanguageCode;
  preferred_language?: LanguageCode;
  preferred_timezone?: TimeZoneID;
}

export function normalizeCompleteSetupRequest(
  request: CompleteSetupRequest,
): CompleteSetupRequest {
  return {
    ...request,
    display_names: normalizeDisplayNames(request.display_names),
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
  const displayNames = validateDisplayNames(
    normalized.display_names,
    normalized.primary_display_name_language,
  );
  if (!displayNames.valid) {
    fields.push("display_names");
  }
  if (!displayNames.primaryPresent) {
    fields.push("primary_display_name_language");
  }
  if (
    normalized.preferred_language !== undefined &&
    !isLanguageCode(normalized.preferred_language)
  ) {
    fields.push("preferred_language");
  }
  if (
    normalized.preferred_timezone !== undefined &&
    !isTimeZoneID(normalized.preferred_timezone)
  ) {
    fields.push("preferred_timezone");
  }
  return fields;
}

export interface CompleteSetupResponse {
  admin_user_id: AdminUserID;
}
