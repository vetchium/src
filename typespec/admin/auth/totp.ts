import type {
  TOTPCode,
  TOTPConfiguration,
  TOTPEnrollmentToken,
  TOTPManualEntryKey,
  TOTPRecoveryCode,
  TOTPRecoveryCodeCount,
} from "../../common/authentication.ts";
import {
  isOpaqueToken,
  isTOTPCode,
  isTOTPRecoveryCode,
} from "../../common/authentication.ts";
import type {
  AdminLoginChallengeToken,
  AuthenticatedSessionResponse,
} from "../common/types.ts";

export interface StartTOTPEnrollmentResponse {
  totp_enrollment_token: TOTPEnrollmentToken;
  provisioning_uri: string;
  manual_entry_key: TOTPManualEntryKey;
  configuration: TOTPConfiguration;
  expires_at: string;
}

export interface ConfirmTOTPEnrollmentRequest {
  totp_enrollment_token: TOTPEnrollmentToken;
  totp_code: TOTPCode;
}

export function validateConfirmTOTPEnrollmentRequest(
  request: ConfirmTOTPEnrollmentRequest,
): string[] {
  const fields: string[] = [];
  if (!isOpaqueToken(request.totp_enrollment_token)) {
    fields.push("totp_enrollment_token");
  }
  if (!isTOTPCode(request.totp_code)) {
    fields.push("totp_code");
  }
  return fields;
}

export interface ConfirmTOTPEnrollmentResponse {
  recovery_codes: TOTPRecoveryCode[];
}

export interface VerifyRecoveryCodeRequest {
  login_challenge_token: AdminLoginChallengeToken;
  recovery_code: TOTPRecoveryCode;
}

export function validateVerifyRecoveryCodeRequest(
  request: VerifyRecoveryCodeRequest,
): string[] {
  const fields: string[] = [];
  if (!isOpaqueToken(request.login_challenge_token)) {
    fields.push("login_challenge_token");
  }
  if (!isTOTPRecoveryCode(request.recovery_code)) {
    fields.push("recovery_code");
  }
  return fields;
}

export interface VerifyRecoveryCodeResponse
  extends AuthenticatedSessionResponse {
  remaining_recovery_codes: TOTPRecoveryCodeCount;
}

export interface RegenerateTOTPRecoveryCodesResponse {
  recovery_codes: TOTPRecoveryCode[];
}
