import type {
  LoginRequest,
  LoginResponse,
  VerifyTFARequest,
} from "../../../../typespec/admin/auth/login.ts";
import type {
  CompletePasswordResetRequest,
  RequestPasswordResetRequest,
} from "../../../../typespec/admin/auth/password.ts";
import type {
  VerifyRecoveryCodeRequest,
  VerifyRecoveryCodeResponse,
} from "../../../../typespec/admin/auth/totp.ts";
import type { AuthenticatedSessionResponse } from "../../../../typespec/admin/auth/types.ts";
import type {
  CompleteSetupRequest,
  CompleteSetupResponse,
} from "../../../../typespec/admin/users/invitations.ts";
import { requestJson, requestVoid } from "../../api/client";

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

function idempotencyHeaders(): HeadersInit {
  return { "Idempotency-Key": crypto.randomUUID() };
}

export function login(request: LoginRequest): Promise<LoginResponse> {
  return requestJson("/admin/login", {
    method: "POST",
    body: jsonBody(request),
  });
}

export function verifyTFA(
  request: VerifyTFARequest,
): Promise<AuthenticatedSessionResponse> {
  return requestJson("/admin/login/tfa", {
    method: "POST",
    headers: idempotencyHeaders(),
    body: jsonBody(request),
  });
}

export function verifyRecoveryCode(
  request: VerifyRecoveryCodeRequest,
): Promise<VerifyRecoveryCodeResponse> {
  return requestJson("/admin/login/recovery-code", {
    method: "POST",
    headers: idempotencyHeaders(),
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
): Promise<void> {
  return requestVoid("/admin/complete-password-reset", {
    method: "POST",
    headers: idempotencyHeaders(),
    body: jsonBody(request),
  });
}

export function completeSetup(
  request: CompleteSetupRequest,
): Promise<CompleteSetupResponse> {
  return requestJson("/admin/complete-setup", {
    method: "POST",
    headers: idempotencyHeaders(),
    body: jsonBody(request),
  });
}
