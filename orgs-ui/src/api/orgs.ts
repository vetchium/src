import type { IdempotencyKey } from "typespec/common/idempotency";
import type {
  CheckDomainResponse,
  MyInfoResponse,
} from "typespec/orgs/account/account";
import type {
  LoginRequest,
  LoginResponse,
  ReauthenticateRequest,
  ReauthenticateResponse,
  VerifyTFARequest,
} from "typespec/orgs/auth/login";
import type {
  ChangePasswordRequest,
  CompletePasswordResetRequest,
  RequestPasswordResetRequest,
} from "typespec/orgs/auth/password";
import type {
  CompleteSignupRequest,
  CompleteSignupResponse,
  GetSignupDetailsRequest,
  RequestSignupRequest,
  SignupCompletionPendingResponse,
  SignupDetailsResponse,
} from "typespec/orgs/auth/signup";
import type {
  ConfirmTOTPEnrollmentRequest,
  ConfirmTOTPEnrollmentResponse,
  RegenerateTOTPRecoveryCodesResponse,
  StartTOTPEnrollmentResponse,
  VerifyRecoveryCodeRequest,
  VerifyRecoveryCodeResponse,
} from "typespec/orgs/auth/totp";
import type { AuthenticatedSessionResponse } from "typespec/orgs/auth/types";
import { apiRequest } from "./client";

export const orgsAPI = {
  requestSignup: (
    body: RequestSignupRequest,
    idempotencyKey: IdempotencyKey,
    tenantId: string,
  ) => apiRequest<void>("/request-signup", { body, idempotencyKey, tenantId }),
  getSignupDetails: (body: GetSignupDetailsRequest, tenantId: string) =>
    apiRequest<SignupDetailsResponse>("/get-signup-details", {
      body,
      tenantId,
    }),
  completeSignup: (
    body: CompleteSignupRequest,
    idempotencyKey: IdempotencyKey,
    tenantId: string,
  ) =>
    apiRequest<CompleteSignupResponse | SignupCompletionPendingResponse>(
      "/complete-signup",
      { body, idempotencyKey, tenantId },
    ),
  login: (body: LoginRequest, tenantId: string) =>
    apiRequest<LoginResponse>("/login", { body, tenantId }),
  verifyTFA: (
    body: VerifyTFARequest,
    idempotencyKey: IdempotencyKey,
    tenantId: string,
  ) =>
    apiRequest<AuthenticatedSessionResponse>("/login/tfa", {
      body,
      idempotencyKey,
      tenantId,
    }),
  verifyRecoveryCode: (
    body: VerifyRecoveryCodeRequest,
    idempotencyKey: IdempotencyKey,
    tenantId: string,
  ) =>
    apiRequest<VerifyRecoveryCodeResponse>("/login/recovery-code", {
      body,
      idempotencyKey,
      tenantId,
    }),
  logout: (token: string, tenantId: string) =>
    apiRequest<void>("/logout", { method: "POST", token, tenantId }),
  reauthenticate: (body: ReauthenticateRequest) =>
    apiRequest<ReauthenticateResponse>("/reauthenticate", { body }),
  requestPasswordReset: (
    body: RequestPasswordResetRequest,
    idempotencyKey: IdempotencyKey,
    tenantId: string,
  ) =>
    apiRequest<void>("/request-password-reset", {
      body,
      idempotencyKey,
      tenantId,
    }),
  completePasswordReset: (
    body: CompletePasswordResetRequest,
    idempotencyKey: IdempotencyKey,
    tenantId: string,
  ) =>
    apiRequest<void>("/complete-password-reset", {
      body,
      idempotencyKey,
      tenantId,
    }),
  changePassword: (body: ChangePasswordRequest) =>
    apiRequest<void>("/change-password", { body }),
  startTOTPEnrollment: (idempotencyKey: IdempotencyKey) =>
    apiRequest<StartTOTPEnrollmentResponse>("/start-totp-enrollment", {
      method: "POST",
      idempotencyKey,
    }),
  confirmTOTPEnrollment: (
    body: ConfirmTOTPEnrollmentRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ConfirmTOTPEnrollmentResponse>("/confirm-totp-enrollment", {
      body,
      idempotencyKey,
    }),
  disableTOTP: () => apiRequest<void>("/disable-totp", { method: "POST" }),
  regenerateRecoveryCodes: (idempotencyKey: IdempotencyKey) =>
    apiRequest<RegenerateTOTPRecoveryCodesResponse>(
      "/regenerate-totp-recovery-codes",
      { method: "POST", idempotencyKey },
    ),
  myInfo: () => apiRequest<MyInfoResponse>("/my-info"),
  checkDomain: () =>
    apiRequest<CheckDomainResponse>("/check-domain", { method: "POST" }),
};
