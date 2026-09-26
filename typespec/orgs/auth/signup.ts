import type { NewPassword } from "../../common/authentication.ts";
import { isNewPassword, isOpaqueToken } from "../../common/authentication.ts";
import type { EmailAddress } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";
import type { DisplayName } from "../../common/localization.ts";
import {
  isDisplayName,
  normalizeDisplayName,
} from "../../common/localization.ts";
import {
  type FrontendLocale,
  isFrontendLocale,
  isOrgDomain,
  type OrgDomain,
} from "../types.ts";

export type OrgSignupToken = string;

export interface RequestSignupRequest {
  email_address: EmailAddress;
  preferred_language: FrontendLocale;
}

export function normalizeRequestSignupRequest(
  request: RequestSignupRequest,
): RequestSignupRequest {
  return {
    ...request,
    email_address: normalizeEmailAddress(request.email_address),
  };
}

/** The domain a signup claims: the email address's domain. */
export function signupDomain(emailAddress: EmailAddress): OrgDomain {
  const normalized = normalizeEmailAddress(emailAddress);
  return normalized.slice(normalized.lastIndexOf("@") + 1);
}

export function validateRequestSignupRequest(
  request: RequestSignupRequest,
): string[] {
  const normalized = normalizeRequestSignupRequest(request);
  const fields: string[] = [];
  if (
    !isEmailAddress(normalized.email_address) ||
    !isOrgDomain(signupDomain(normalized.email_address))
  ) {
    fields.push("email_address");
  }
  if (!isFrontendLocale(normalized.preferred_language)) {
    fields.push("preferred_language");
  }
  return fields;
}

export interface GetSignupDetailsRequest {
  signup_token: OrgSignupToken;
}

export function validateGetSignupDetailsRequest(
  request: GetSignupDetailsRequest,
): string[] {
  return isOpaqueToken(request.signup_token) ? [] : ["signup_token"];
}

export interface SignupDetailsResponse {
  domain: OrgDomain;
  dns_record_name: string;
  dns_record_value: string;
  expires_at: string;
}

export interface CompleteSignupRequest {
  signup_token: OrgSignupToken;
  org_display_name: DisplayName;
  password: NewPassword;
}

export function normalizeCompleteSignupRequest(
  request: CompleteSignupRequest,
): CompleteSignupRequest {
  return {
    ...request,
    org_display_name: normalizeDisplayName(request.org_display_name),
  };
}

export function validateCompleteSignupRequest(
  request: CompleteSignupRequest,
): string[] {
  const normalized = normalizeCompleteSignupRequest(request);
  const fields: string[] = [];
  if (!isOpaqueToken(normalized.signup_token)) fields.push("signup_token");
  if (!isDisplayName(normalized.org_display_name)) {
    fields.push("org_display_name");
  }
  if (!isNewPassword(normalized.password)) fields.push("password");
  return fields;
}

export interface CompleteSignupResponse {
  domain: OrgDomain;
}

export interface SignupCompletionPendingResponse {
  operation_id: string;
}
