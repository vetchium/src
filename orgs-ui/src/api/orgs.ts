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
import type {
  ListOrgSignupRegionsRequest,
  ListOrgSignupRegionsResponse,
} from "typespec/regions/regions";
import { apiRequest } from "./client";

export const orgsAPI = {
  listSignupRegions: (body: ListOrgSignupRegionsRequest) =>
    apiRequest<ListOrgSignupRegionsResponse>("/list-signup-regions", { body }),
  requestSignup: (body: RequestSignupRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<void>("/request-signup", { body, idempotencyKey }),
  getSignupDetails: (body: GetSignupDetailsRequest) =>
    apiRequest<SignupDetailsResponse>("/get-signup-details", { body }),
  completeSignup: (
    body: CompleteSignupRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<CompleteSignupResponse | SignupCompletionPendingResponse>(
      "/complete-signup",
      { body, idempotencyKey },
    ),
  login: (body: LoginRequest) => apiRequest<LoginResponse>("/login", { body }),
  verifyTFA: (body: VerifyTFARequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<AuthenticatedSessionResponse>("/login/tfa", {
      body,
      idempotencyKey,
    }),
  verifyRecoveryCode: (
    body: VerifyRecoveryCodeRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<VerifyRecoveryCodeResponse>("/login/recovery-code", {
      body,
      idempotencyKey,
    }),
  logout: (token: string) =>
    apiRequest<void>("/logout", { method: "POST", token }),
  reauthenticate: (body: ReauthenticateRequest) =>
    apiRequest<ReauthenticateResponse>("/reauthenticate", { body }),
  requestPasswordReset: (
    body: RequestPasswordResetRequest,
    idempotencyKey: IdempotencyKey,
  ) => apiRequest<void>("/request-password-reset", { body, idempotencyKey }),
  completePasswordReset: (
    body: CompletePasswordResetRequest,
    idempotencyKey: IdempotencyKey,
  ) => apiRequest<void>("/complete-password-reset", { body, idempotencyKey }),
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
