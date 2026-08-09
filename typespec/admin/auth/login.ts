import type { TOTPCode } from "../../common/authentication.ts";
import { isOpaqueToken, isTOTPCode } from "../../common/authentication.ts";
import type { EmailAddress, Password } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";
import type { TimeZoneID } from "../../common/localization.ts";
import type {
  AdminLoginChallengeToken,
  AuthenticatedSessionResponse,
  LanguageCode,
} from "../common/types.ts";

export interface LoginRequest {
  email_address: EmailAddress;
  password: Password;
}

export function normalizeLoginRequest(request: LoginRequest): LoginRequest {
  return {
    ...request,
    email_address: normalizeEmailAddress(request.email_address),
  };
}

export function validateLoginRequest(request: LoginRequest): string[] {
  const normalized = normalizeLoginRequest(request);
  const fields: string[] = [];
  if (!isEmailAddress(normalized.email_address)) {
    fields.push("email_address");
  }
  if (normalized.password.length === 0) {
    fields.push("password");
  }
  return fields;
}

export interface LoginAuthenticatedResponse
  extends AuthenticatedSessionResponse {
  authentication_state: "authenticated";
}

export interface LoginTOTPRequiredResponse {
  authentication_state: "totp_required";
  login_challenge_token: AdminLoginChallengeToken;
  login_challenge_expires_at: string;
  effective_language: LanguageCode;
  effective_timezone: TimeZoneID;
}

export type LoginResponse =
  | LoginAuthenticatedResponse
  | LoginTOTPRequiredResponse;

export interface VerifyTFARequest {
  login_challenge_token: AdminLoginChallengeToken;
  totp_code: TOTPCode;
}

export function validateVerifyTFARequest(request: VerifyTFARequest): string[] {
  const fields: string[] = [];
  if (!isOpaqueToken(request.login_challenge_token)) {
    fields.push("login_challenge_token");
  }
  if (!isTOTPCode(request.totp_code)) {
    fields.push("totp_code");
  }
  return fields;
}
