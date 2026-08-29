import type {
  LoginRequest,
  LoginResponse,
  ReauthenticateRequest,
  ReauthenticateResponse,
  VerifyTFARequest,
} from "typespec/admin/auth/login";
import type {
  CompletePasswordResetRequest,
  RequestPasswordResetRequest,
} from "typespec/admin/auth/password";
import type {
  VerifyRecoveryCodeRequest,
  VerifyRecoveryCodeResponse,
} from "typespec/admin/auth/totp";
import type { AuthenticatedSessionResponse } from "typespec/admin/auth/types";
import type {
  CompleteSetupRequest,
  CompleteSetupResponse,
} from "typespec/admin/users/invitations";
import type { IdempotencyKey } from "typespec/common/idempotency";
import { idempotencyHeaders, requestJson, requestVoid } from "../../api/client";

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export function login(request: LoginRequest): Promise<LoginResponse> {
  return requestJson("/admin/login", {
    method: "POST",
    body: jsonBody(request),
  });
}

export function reauthenticate(
  request: ReauthenticateRequest,
): Promise<ReauthenticateResponse> {
  return requestJson("/admin/reauthenticate", {
    method: "POST",
    body: jsonBody(request),
  });
}

export function verifyTFA(
  request: VerifyTFARequest,
  idempotencyKey: IdempotencyKey,
): Promise<AuthenticatedSessionResponse> {
  return requestJson("/admin/login/tfa", {
    method: "POST",
    headers: idempotencyHeaders(idempotencyKey),
    body: jsonBody(request),
  });
}

export function verifyRecoveryCode(
  request: VerifyRecoveryCodeRequest,
  idempotencyKey: IdempotencyKey,
): Promise<VerifyRecoveryCodeResponse> {
  return requestJson("/admin/login/recovery-code", {
    method: "POST",
    headers: idempotencyHeaders(idempotencyKey),
    body: jsonBody(request),
  });
}

export function logout(): Promise<void> {
  return requestVoid("/admin/logout", { method: "POST" });
}

export function requestPasswordReset(
  request: RequestPasswordResetRequest,
): Promise<void> {
  return requestVoid("/admin/request-password-reset", {
    method: "POST",
    body: jsonBody(request),
  });
}

export function completePasswordReset(
  request: CompletePasswordResetRequest,
  idempotencyKey: IdempotencyKey,
): Promise<void> {
  return requestVoid("/admin/complete-password-reset", {
    method: "POST",
    headers: idempotencyHeaders(idempotencyKey),
    body: jsonBody(request),
  });
}

export function completeSetup(
  request: CompleteSetupRequest,
  idempotencyKey: IdempotencyKey,
): Promise<CompleteSetupResponse> {
  return requestJson("/admin/complete-setup", {
    method: "POST",
    headers: idempotencyHeaders(idempotencyKey),
    body: jsonBody(request),
  });
}
