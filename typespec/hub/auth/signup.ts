import type { NewPassword } from "../../common/authentication.ts";
import { isNewPassword, isOpaqueToken } from "../../common/authentication.ts";
import type { EmailAddress } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";
import type {
  CountryCode,
  DisplayName,
  FrontendLocale,
} from "../../common/localization.ts";
import {
  isCountryCode,
  isDisplayName,
  isFrontendLocale,
  normalizeDisplayName,
} from "../../common/localization.ts";
import type { HubHandle, HubUserDID } from "../types.ts";

export type HubSignupToken = string;

export interface RequestSignupRequest {
  email_address: EmailAddress;
  display_name: DisplayName;
  preferred_language: FrontendLocale;
  resident_country: CountryCode;
}

export function normalizeRequestSignupRequest(
  request: RequestSignupRequest,
): RequestSignupRequest {
  return {
    ...request,
    email_address: normalizeEmailAddress(request.email_address),
    display_name: normalizeDisplayName(request.display_name),
  };
}

export function validateRequestSignupRequest(
  request: RequestSignupRequest,
): string[] {
  const normalized = normalizeRequestSignupRequest(request);
  const fields: string[] = [];
  if (!isEmailAddress(normalized.email_address)) fields.push("email_address");
  if (!isDisplayName(normalized.display_name)) fields.push("display_name");
  if (!isFrontendLocale(normalized.preferred_language)) {
    fields.push("preferred_language");
  }
  if (!isCountryCode(normalized.resident_country)) {
    fields.push("resident_country");
  }
  return fields;
}

export interface CompleteSignupRequest {
  signup_token: HubSignupToken;
  password: NewPassword;
}

export function validateCompleteSignupRequest(
  request: CompleteSignupRequest,
): string[] {
  const fields: string[] = [];
  if (!isOpaqueToken(request.signup_token)) fields.push("signup_token");
  if (!isNewPassword(request.password)) fields.push("password");
  return fields;
}

export interface CompleteSignupResponse {
  hub_user_did: HubUserDID;
  handle: HubHandle;
}
