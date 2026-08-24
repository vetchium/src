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
  requestSignup: (body: RequestSignupRequest) =>
    apiRequest<void>(`${base}/request-signup`, { body, idempotent: true }),
  completeSignup: (body: CompleteSignupRequest) =>
    apiRequest<CompleteSignupResponse>(`${base}/complete-signup`, {
      body,
      idempotent: true,
    }),
  login: (body: LoginRequest) =>
    apiRequest<LoginResponse>(`${base}/login`, { body }),
  verifyTFA: (body: VerifyTFARequest) =>
    apiRequest<AuthenticatedSessionResponse>(`${base}/login/tfa`, {
      body,
      idempotent: true,
    }),
  verifyRecoveryCode: (body: VerifyRecoveryCodeRequest) =>
    apiRequest<VerifyRecoveryCodeResponse>(`${base}/login/recovery-code`, {
      body,
      idempotent: true,
    }),
  logout: (token: string) =>
    apiRequest<void>(`${base}/logout`, { method: "POST", token }),
  reauthenticate: (body: ReauthenticateRequest) =>
    apiRequest<ReauthenticateResponse>(`${base}/reauthenticate`, { body }),
  requestPasswordReset: (body: RequestPasswordResetRequest) =>
    apiRequest<void>(`${base}/request-password-reset`, {
      body,
      idempotent: true,
    }),
  completePasswordReset: (body: CompletePasswordResetRequest) =>
    apiRequest<void>(`${base}/complete-password-reset`, {
      body,
      idempotent: true,
    }),
  changePassword: (body: ChangePasswordRequest) =>
    apiRequest<void>(`${base}/change-password`, { body }),
  myInfo: () => apiRequest<MyInfoResponse>(`${base}/my-info`),
  setPreferredLanguage: (body: SetPreferredLanguageRequest) =>
    apiRequest<void>(`${base}/set-preferred-language`, { body }),
  setResidentCountry: (body: SetResidentCountryRequest) =>
    apiRequest<void>(`${base}/set-resident-country`, { body }),
  startTOTPEnrollment: () =>
    apiRequest<StartTOTPEnrollmentResponse>(`${base}/start-totp-enrollment`, {
      method: "POST",
      idempotent: true,
    }),
  confirmTOTPEnrollment: (body: ConfirmTOTPEnrollmentRequest) =>
    apiRequest<ConfirmTOTPEnrollmentResponse>(
      `${base}/confirm-totp-enrollment`,
      {
        body,
        idempotent: true,
      },
    ),
  disableTOTP: () =>
    apiRequest<void>(`${base}/disable-totp`, { method: "POST" }),
  regenerateRecoveryCodes: () =>
    apiRequest<RegenerateTOTPRecoveryCodesResponse>(
      `${base}/regenerate-totp-recovery-codes`,
      { method: "POST", idempotent: true },
    ),
};
