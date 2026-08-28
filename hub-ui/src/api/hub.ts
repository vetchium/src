import type { IdempotencyKey } from "../../../typespec/common/idempotency.ts";
import type {
  LoginRequest,
  LoginResponse,
  ReauthenticateRequest,
  ReauthenticateResponse,
  VerifyTFARequest,
} from "../../../typespec/hub/auth/login.ts";
import type {
  ChangePasswordRequest,
  CompletePasswordResetRequest,
  RequestPasswordResetRequest,
} from "../../../typespec/hub/auth/password.ts";
import type {
  CompleteSignupRequest,
  CompleteSignupResponse,
  RequestSignupRequest,
} from "../../../typespec/hub/auth/signup.ts";
import type {
  ConfirmTOTPEnrollmentRequest,
  ConfirmTOTPEnrollmentResponse,
  RegenerateTOTPRecoveryCodesResponse,
  StartTOTPEnrollmentResponse,
  VerifyRecoveryCodeRequest,
  VerifyRecoveryCodeResponse,
} from "../../../typespec/hub/auth/totp.ts";
import type { AuthenticatedSessionResponse } from "../../../typespec/hub/auth/types.ts";
import type {
  MyInfoResponse,
  SetPreferredLanguageRequest,
  SetResidentCountryRequest,
} from "../../../typespec/hub/users/profile.ts";
import { apiRequest } from "./client";

const base = "/api/hub";

export const hubAPI = {
  requestSignup: (body: RequestSignupRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<void>(`${base}/request-signup`, { body, idempotencyKey }),
  completeSignup: (
    body: CompleteSignupRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<CompleteSignupResponse>(`${base}/complete-signup`, {
      body,
      idempotencyKey,
    }),
  login: (body: LoginRequest) =>
    apiRequest<LoginResponse>(`${base}/login`, { body }),
  verifyTFA: (body: VerifyTFARequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<AuthenticatedSessionResponse>(`${base}/login/tfa`, {
      body,
      idempotencyKey,
    }),
  verifyRecoveryCode: (
    body: VerifyRecoveryCodeRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<VerifyRecoveryCodeResponse>(`${base}/login/recovery-code`, {
      body,
      idempotencyKey,
    }),
  logout: (token: string) =>
    apiRequest<void>(`${base}/logout`, { method: "POST", token }),
  reauthenticate: (body: ReauthenticateRequest) =>
    apiRequest<ReauthenticateResponse>(`${base}/reauthenticate`, { body }),
  requestPasswordReset: (
    body: RequestPasswordResetRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/request-password-reset`, {
      body,
      idempotencyKey,
    }),
  completePasswordReset: (
    body: CompletePasswordResetRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/complete-password-reset`, {
      body,
      idempotencyKey,
    }),
  changePassword: (body: ChangePasswordRequest) =>
    apiRequest<void>(`${base}/change-password`, { body }),
  myInfo: () => apiRequest<MyInfoResponse>(`${base}/my-info`),
  setPreferredLanguage: (body: SetPreferredLanguageRequest) =>
    apiRequest<void>(`${base}/set-preferred-language`, { body }),
  setResidentCountry: (body: SetResidentCountryRequest) =>
    apiRequest<void>(`${base}/set-resident-country`, { body }),
  startTOTPEnrollment: (idempotencyKey: IdempotencyKey) =>
    apiRequest<StartTOTPEnrollmentResponse>(`${base}/start-totp-enrollment`, {
      method: "POST",
      idempotencyKey,
    }),
  confirmTOTPEnrollment: (
    body: ConfirmTOTPEnrollmentRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ConfirmTOTPEnrollmentResponse>(
      `${base}/confirm-totp-enrollment`,
      {
        body,
        idempotencyKey,
      },
    ),
  disableTOTP: () =>
    apiRequest<void>(`${base}/disable-totp`, { method: "POST" }),
  regenerateRecoveryCodes: (idempotencyKey: IdempotencyKey) =>
    apiRequest<RegenerateTOTPRecoveryCodesResponse>(
      `${base}/regenerate-totp-recovery-codes`,
      { method: "POST", idempotencyKey },
    ),
};
