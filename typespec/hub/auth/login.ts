import type { TOTPCode } from "../../common/authentication.ts";
import { isOpaqueToken, isTOTPCode } from "../../common/authentication.ts";
import type { EmailAddress, Password } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";
import type {
  AuthenticatedSessionResponse,
  HubLoginChallengeToken,
} from "./types.ts";

export interface LoginRequest {
  email_address: EmailAddress;
  password: Password;
  remember_me?: boolean;
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
  if (!isEmailAddress(normalized.email_address)) fields.push("email_address");
  if (normalized.password.length === 0) fields.push("password");
  return fields;
}

export interface ReauthenticateRequest {
  password: Password;
}

export function validateReauthenticateRequest(
  request: ReauthenticateRequest,
): string[] {
  return request.password.length === 0 ? ["password"] : [];
}

export interface ReauthenticateResponse {
  session_authenticated_at: string;
}

export const AuthenticationStateAuthenticated = "authenticated" as const;
export const AuthenticationStateTOTPRequired = "totp_required" as const;
export type AuthenticationState =
  | typeof AuthenticationStateAuthenticated
  | typeof AuthenticationStateTOTPRequired;

export interface LoginAuthenticatedResponse
  extends AuthenticatedSessionResponse {
  authentication_state: typeof AuthenticationStateAuthenticated;
}

export interface LoginTOTPRequiredResponse {
  authentication_state: typeof AuthenticationStateTOTPRequired;
  login_challenge_token: HubLoginChallengeToken;
  login_challenge_expires_at: string;
}

export type LoginResponse =
  | LoginAuthenticatedResponse
  | LoginTOTPRequiredResponse;

export interface VerifyTFARequest {
  login_challenge_token: HubLoginChallengeToken;
  totp_code: TOTPCode;
}

export function validateVerifyTFARequest(request: VerifyTFARequest): string[] {
  const fields: string[] = [];
  if (!isOpaqueToken(request.login_challenge_token)) {
    fields.push("login_challenge_token");
  }
  if (!isTOTPCode(request.totp_code)) fields.push("totp_code");
  return fields;
}
