import type { ChangePasswordRequest } from "../../../../typespec/admin/auth/password.ts";
import type {
  ConfirmTOTPEnrollmentRequest,
  ConfirmTOTPEnrollmentResponse,
  RegenerateTOTPRecoveryCodesResponse,
  StartTOTPEnrollmentResponse,
} from "../../../../typespec/admin/auth/totp.ts";
import type { IdempotencyKey } from "../../../../typespec/common/idempotency.ts";
import { idempotencyHeaders, requestJson, requestVoid } from "../../api/client";

export function changePassword(request: ChangePasswordRequest): Promise<void> {
  return requestVoid("/admin/change-password", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function startTOTPEnrollment(
  idempotencyKey: IdempotencyKey,
): Promise<StartTOTPEnrollmentResponse> {
  return requestJson("/admin/start-totp-enrollment", {
    method: "POST",
    headers: idempotencyHeaders(idempotencyKey),
  });
}

export function confirmTOTPEnrollment(
  request: ConfirmTOTPEnrollmentRequest,
  idempotencyKey: IdempotencyKey,
): Promise<ConfirmTOTPEnrollmentResponse> {
  return requestJson("/admin/confirm-totp-enrollment", {
    method: "POST",
    headers: idempotencyHeaders(idempotencyKey),
    body: JSON.stringify(request),
  });
}

export function disableTOTP(): Promise<void> {
  return requestVoid("/admin/disable-totp", { method: "POST" });
}

export function regenerateTOTPRecoveryCodes(
  idempotencyKey: IdempotencyKey,
): Promise<RegenerateTOTPRecoveryCodesResponse> {
  return requestJson("/admin/regenerate-totp-recovery-codes", {
    method: "POST",
    headers: idempotencyHeaders(idempotencyKey),
  });
}
