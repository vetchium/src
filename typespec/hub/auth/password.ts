import type { NewPassword } from "../../common/authentication.ts";
import { isNewPassword, isOpaqueToken } from "../../common/authentication.ts";
import type { EmailAddress } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";

export type HubPasswordResetToken = string;

export interface RequestPasswordResetRequest {
  email_address: EmailAddress;
}

export function normalizeRequestPasswordResetRequest(
  request: RequestPasswordResetRequest,
): RequestPasswordResetRequest {
  return {
    ...request,
    email_address: normalizeEmailAddress(request.email_address),
  };
}

export function validateRequestPasswordResetRequest(
  request: RequestPasswordResetRequest,
): string[] {
  return isEmailAddress(normalizeEmailAddress(request.email_address))
    ? []
    : ["email_address"];
}

export interface CompletePasswordResetRequest {
  reset_token: HubPasswordResetToken;
  new_password: NewPassword;
}

export function validateCompletePasswordResetRequest(
  request: CompletePasswordResetRequest,
): string[] {
  const fields: string[] = [];
  if (!isOpaqueToken(request.reset_token)) fields.push("reset_token");
  if (!isNewPassword(request.new_password)) fields.push("new_password");
  return fields;
}

export interface ChangePasswordRequest {
  new_password: NewPassword;
}

export function validateChangePasswordRequest(
  request: ChangePasswordRequest,
): string[] {
  return isNewPassword(request.new_password) ? [] : ["new_password"];
}
