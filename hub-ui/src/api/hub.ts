import type { IdempotencyKey } from "typespec/common/idempotency";
import type {
  LoginRequest,
  LoginResponse,
  ReauthenticateRequest,
  ReauthenticateResponse,
  VerifyTFARequest,
} from "typespec/hub/auth/login";
import type {
  ChangePasswordRequest,
  CompletePasswordResetRequest,
  RequestPasswordResetRequest,
} from "typespec/hub/auth/password";
import type {
  CompleteSignupRequest,
  CompleteSignupResponse,
  RequestSignupRequest,
  SignupCompletionPendingResponse,
} from "typespec/hub/auth/signup";
import type {
  ConfirmTOTPEnrollmentRequest,
  ConfirmTOTPEnrollmentResponse,
  RegenerateTOTPRecoveryCodesResponse,
  StartTOTPEnrollmentResponse,
  VerifyRecoveryCodeRequest,
  VerifyRecoveryCodeResponse,
} from "typespec/hub/auth/totp";
import type { AuthenticatedSessionResponse } from "typespec/hub/auth/types";
import type {
  GetOperationRequest,
  OperationStatus,
  PendingOperation,
} from "typespec/hub/operations/operations";
import type { AliasState, SetAliasRequest } from "typespec/hub/profile/alias";
import type { PictureContentType } from "typespec/hub/profile/picture";
import type {
  AddProfessionalEmailRequest,
  ListProfessionalEmailsRequest,
  ListProfessionalEmailsResponse,
  ProfessionalEmail,
  ProfessionalEmailChallenge,
  ProfessionalEmailIDRequest,
  VerifyProfessionalEmailRequest,
} from "typespec/hub/profile/professional_email";
import type {
  ChangeLanguageAbilityRequest,
  DeleteProfileEntryRequest,
  PublicProfile,
  ReadProfileRequest,
  SaveCertificationRequest,
  SaveEducationalQualificationRequest,
  SaveWorkExperienceRequest,
  SetPublicFieldsRequest,
} from "typespec/hub/profile/public";
import type {
  HubSubscription,
  SetSubscriptionPlanRequest,
} from "typespec/hub/subscriptions/subscriptions";
import type {
  MyInfoResponse,
  SetPreferredJobCountriesRequest,
  SetPreferredLanguageRequest,
  SetResidentCountryRequest,
} from "typespec/hub/users/profile";
import type {
  ListSignupRegionsRequest,
  ListSignupRegionsResponse,
} from "typespec/regions/regions";
import { apiRequest } from "./client";

const base = "/api/hub";

export const hubAPI = {
  listSignupRegions: (body: ListSignupRegionsRequest) =>
    apiRequest<ListSignupRegionsResponse>(`${base}/list-signup-regions`, {
      body,
    }),
  requestSignup: (body: RequestSignupRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<void>(`${base}/request-signup`, { body, idempotencyKey }),
  completeSignup: (
    body: CompleteSignupRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<CompleteSignupResponse | SignupCompletionPendingResponse>(
      `${base}/complete-signup`,
      {
        body,
        idempotencyKey,
      },
    ),
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
  setPreferredJobCountries: (body: SetPreferredJobCountriesRequest) =>
    apiRequest<void>(`${base}/set-preferred-job-countries`, { body }),
  myInfo: () => apiRequest<MyInfoResponse>(`${base}/my-info`),
  readProfile: (body: ReadProfileRequest) =>
    apiRequest<PublicProfile>(`${base}/profile/read`, { body }),
  setPublicFields: (
    body: SetPublicFieldsRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/set-public-fields`, {
      body,
      idempotencyKey,
    }),
  saveWorkExperience: (
    body: SaveWorkExperienceRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/save-work-experience`, {
      body,
      idempotencyKey,
    }),
  deleteWorkExperience: (
    body: DeleteProfileEntryRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/delete-work-experience`, {
      body,
      idempotencyKey,
    }),
  saveCertification: (
    body: SaveCertificationRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/save-certification`, {
      body,
      idempotencyKey,
    }),
  deleteCertification: (
    body: DeleteProfileEntryRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/delete-certification`, {
      body,
      idempotencyKey,
    }),
  saveEducation: (
    body: SaveEducationalQualificationRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/save-education`, {
      body,
      idempotencyKey,
    }),
  deleteEducation: (
    body: DeleteProfileEntryRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/delete-education`, {
      body,
      idempotencyKey,
    }),
  addLanguageAbility: (
    body: ChangeLanguageAbilityRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/add-language`, {
      body,
      idempotencyKey,
    }),
  deleteLanguageAbility: (
    body: ChangeLanguageAbilityRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/delete-language`, {
      body,
      idempotencyKey,
    }),
  aliasState: () => apiRequest<AliasState>(`${base}/profile/alias/state`),
  setAlias: (body: SetAliasRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<PendingOperation>(`${base}/profile/alias/set`, {
      body,
      idempotencyKey,
    }),
  operationStatus: (body: GetOperationRequest) =>
    apiRequest<OperationStatus>(`${base}/operations/status`, { body }),
  uploadPicture: (
    body: ArrayBuffer,
    contentType: PictureContentType,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/picture/upload`, {
      body,
      idempotencyKey,
      headers: { "Content-Type": contentType },
    }),
  removePicture: (idempotencyKey: IdempotencyKey) =>
    apiRequest<void>(`${base}/profile/picture/remove`, {
      body: {},
      idempotencyKey,
    }),
  listProfessionalEmails: (body: ListProfessionalEmailsRequest) =>
    apiRequest<ListProfessionalEmailsResponse>(
      `${base}/profile/professional-email/list`,
      { body },
    ),
  addProfessionalEmail: (
    body: AddProfessionalEmailRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ProfessionalEmail>(`${base}/profile/professional-email/add`, {
      body,
      idempotencyKey,
    }),
  requestProfessionalEmailCode: (
    body: ProfessionalEmailIDRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ProfessionalEmailChallenge>(
      `${base}/profile/professional-email/request-code`,
      { body, idempotencyKey },
    ),
  verifyProfessionalEmail: (
    body: VerifyProfessionalEmailRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/professional-email/verify`, {
      body,
      idempotencyKey,
    }),
  deleteProfessionalEmail: (
    body: ProfessionalEmailIDRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<void>(`${base}/profile/professional-email/delete`, {
      body,
      idempotencyKey,
    }),
  setPreferredLanguage: (body: SetPreferredLanguageRequest) =>
    apiRequest<void>(`${base}/set-preferred-language`, { body }),
  setResidentCountry: (body: SetResidentCountryRequest) =>
    apiRequest<void>(`${base}/set-resident-country`, { body }),
  mySubscription: () => apiRequest<HubSubscription>(`${base}/my-subscription`),
  setSubscriptionPlan: (
    body: SetSubscriptionPlanRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<HubSubscription>(`${base}/set-subscription-plan`, {
      body,
      idempotencyKey,
    }),
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
