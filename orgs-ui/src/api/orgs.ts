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
  CompleteGoogleSignInRequest,
  StartGoogleSignInRequest,
  StartGoogleSignInResponse,
} from "typespec/orgs/auth/sso";
import type {
  ConfirmTOTPEnrollmentRequest,
  ConfirmTOTPEnrollmentResponse,
  RegenerateTOTPRecoveryCodesResponse,
  StartTOTPEnrollmentResponse,
  VerifyRecoveryCodeRequest,
  VerifyRecoveryCodeResponse,
} from "typespec/orgs/auth/totp";
import type { AuthenticatedSessionResponse } from "typespec/orgs/auth/types";
import type { ListPermissionsResponse } from "typespec/orgs/authorization/management";
import type { SetGoogleSignInRequest } from "typespec/orgs/settings/google_sign_in";
import type { LogoContentType } from "typespec/orgs/settings/logo";
import type {
  ListInvoicesRequest,
  ListInvoicesResponse,
  OrgPaymentMethod,
  OrgSubscription,
  PayInvoiceRequest,
  SetPaymentMethodRequest,
  SetSubscriptionPlanRequest,
} from "typespec/orgs/subscriptions/subscriptions";
import type {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  CancelInvitationsRequest,
  GetInvitationDetailsRequest,
  InvitationDetailsResponse,
  InviteUsersRequest,
  InviteUsersResponse,
  ListInvitationsRequest,
  ListInvitationsResponse,
  ResendInvitationRequest,
  ResendInvitationResponse,
} from "typespec/orgs/users/invitations";
import type {
  BulkDisableUsersRequest,
  BulkEnableUsersRequest,
  BulkSetUserPermissionsRequest,
  DisableUserRequest,
  EnableUserRequest,
  ListUsersRequest,
  ListUsersResponse,
  SetUserPermissionsRequest,
  UserSummaryResponse,
} from "typespec/orgs/users/management";
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
  startGoogleSignIn: (body: StartGoogleSignInRequest, tenantId: string) =>
    apiRequest<StartGoogleSignInResponse>("/sso/google/start", {
      body,
      tenantId,
    }),
  completeGoogleSignIn: (body: CompleteGoogleSignInRequest, tenantId: string) =>
    apiRequest<AuthenticatedSessionResponse>("/sso/google/complete", {
      body,
      tenantId,
    }),
  setGoogleSignIn: (body: SetGoogleSignInRequest) =>
    apiRequest<void>("/set-google-sign-in", { body }),
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
  uploadLogo: (
    image: Blob,
    contentType: LogoContentType,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>("/logo/upload", {
      body: image,
      contentType,
      idempotencyKey,
    }),
  removeLogo: (idempotencyKey: IdempotencyKey) =>
    apiRequest<void>("/logo/remove", { method: "POST", idempotencyKey }),
  mySubscription: () => apiRequest<OrgSubscription>("/my-subscription"),
  setSubscriptionPlan: (
    body: SetSubscriptionPlanRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<OrgSubscription>("/set-subscription-plan", {
      body,
      idempotencyKey,
    }),
  setPaymentMethod: (body: SetPaymentMethodRequest) =>
    apiRequest<OrgPaymentMethod>("/set-payment-method", { body }),
  removePaymentMethod: () =>
    apiRequest<void>("/remove-payment-method", { method: "POST" }),
  listInvoices: (body: ListInvoicesRequest) =>
    apiRequest<ListInvoicesResponse>("/list-invoices", { body }),
  payInvoice: (body: PayInvoiceRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<OrgSubscription>("/pay-invoice", { body, idempotencyKey }),
  listPermissions: () =>
    apiRequest<ListPermissionsResponse>("/list-permissions"),
  listUsers: (body: ListUsersRequest) =>
    apiRequest<ListUsersResponse>("/list-users", { body }),
  userSummary: () =>
    apiRequest<UserSummaryResponse>("/user-summary", { method: "POST" }),
  disableUser: (body: DisableUserRequest) =>
    apiRequest<void>("/disable-user", { body }),
  bulkDisableUsers: (body: BulkDisableUsersRequest) =>
    apiRequest<void>("/bulk-disable-users", { body }),
  enableUser: (body: EnableUserRequest) =>
    apiRequest<void>("/enable-user", { body }),
  bulkEnableUsers: (body: BulkEnableUsersRequest) =>
    apiRequest<void>("/bulk-enable-users", { body }),
  setUserPermissions: (body: SetUserPermissionsRequest) =>
    apiRequest<void>("/set-user-permissions", { body }),
  bulkSetUserPermissions: (body: BulkSetUserPermissionsRequest) =>
    apiRequest<void>("/bulk-set-user-permissions", { body }),
  inviteUsers: (body: InviteUsersRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<InviteUsersResponse>("/invite-users", { body, idempotencyKey }),
  listInvitations: (body: ListInvitationsRequest) =>
    apiRequest<ListInvitationsResponse>("/list-invitations", { body }),
  resendInvitation: (
    body: ResendInvitationRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ResendInvitationResponse>("/resend-invitation", {
      body,
      idempotencyKey,
    }),
  cancelInvitations: (body: CancelInvitationsRequest) =>
    apiRequest<void>("/cancel-invitations", { body }),
  getInvitationDetails: (body: GetInvitationDetailsRequest, tenantId: string) =>
    apiRequest<InvitationDetailsResponse>("/get-invitation-details", {
      body,
      tenantId,
    }),
  acceptInvitation: (
    body: AcceptInvitationRequest,
    idempotencyKey: IdempotencyKey,
    tenantId: string,
  ) =>
    apiRequest<AcceptInvitationResponse>("/accept-invitation", {
      body,
      idempotencyKey,
      tenantId,
    }),
  checkDomain: () =>
    apiRequest<CheckDomainResponse>("/check-domain", { method: "POST" }),
};
