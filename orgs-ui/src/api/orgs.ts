import type { IdempotencyKey } from "typespec/common/idempotency";
import type {
  CheckDomainResponse,
  MyInfoResponse,
} from "typespec/orgs/account/account";
import type {
  AICreditsResponse,
  AIOptions,
  AISettingsResponse,
  BuyAICreditPackRequest,
  DraftOpeningRequest,
  DraftOpeningResponse,
  GetAIOptionsRequest,
  GetAIUsageTextRequest,
  ListAICreditLotsRequest,
  ListAICreditLotsResponse,
  ListAIUsageRequest,
  ListAIUsageResponse,
  SetAISettingsRequest,
} from "typespec/orgs/ai/ai";
import type { AIUsageText } from "typespec/orgs/ai/types";
import type {
  ApplicationActionRequest,
  ApplicationCounts,
  ApplicationDetail,
  ApplicationJoinedOnRequest,
  ApplicationSeparatedOnRequest,
  ApplicationStageRequest,
  CancelInterviewRequest,
  ChangeInterviewRequest,
  ExtendApplicationOfferRequest,
  GetApplicationCountsRequest,
  GetApplicationRequest,
  ListApplicationHistoryRequest,
  ListApplicationHistoryResponse,
  ListApplicationsRequest,
  ListApplicationsResponse,
  ListMyInterviewsRequest,
  ListMyInterviewsResponse,
  OfferLetterUploaded,
  RecordAssessmentResultRequest,
  RecordBackgroundCheckResultRequest,
  RecordInterviewOutcomeRequest,
  RequestBackgroundCheckConsentRequest,
  RouteApplicationRequest,
  ScheduleInterviewRequest,
  SubmitInterviewFeedbackRequest,
} from "typespec/orgs/applications/applications";
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
import type {
  CreatePipelineTemplateRequest,
  DeletePipelineTemplateRequest,
  ListPipelineTemplatesRequest,
  ListPipelineTemplatesResponse,
  PipelineTemplate,
  UpdatePipelineTemplateRequest,
} from "typespec/orgs/hiring/pipelines";
import type {
  AssignOpeningProviderRequest,
  GetOpeningProvidersRequest,
  OpeningProviders,
  UnassignOpeningProviderRequest,
} from "typespec/orgs/marketplace/assignments";
import type {
  ListCreditedApplicationsRequest,
  ListCreditedApplicationsResponse,
} from "typespec/orgs/marketplace/attribution";
import type {
  AddContactNoteRequest,
  AddedNote,
  AddPersonNoteRequest,
  AgencyProfile,
  Contact,
  ContactReference,
  ConversationDetail,
  ConversationMessage,
  DeleteContactNoteRequest,
  DeletedNote,
  EditContactNoteRequest,
  GetConversationRequest,
  ListContactNotesRequest,
  ListContactNotesResponse,
  ListContactsRequest,
  ListContactsResponse,
  MarkConversationReadRequest,
  SendMessageRequest,
  StartConversationRequest,
  ViewHubProfileRequest,
} from "typespec/orgs/marketplace/contacts/contacts";
import type {
  EndEngagementRequest,
  Engagement,
  EngagementTarget,
  GetEngagementRequest,
  ListEngagementsRequest,
  ListEngagementsResponse,
  ProposeEngagementRequest,
  SetEngagementReferenceRequest,
} from "typespec/orgs/marketplace/engagements";
import type {
  CreateListingRequest,
  GetListingRequest,
  Listing,
  ListingDetail,
  ListingTarget,
  ListListingsResponse,
  SearchListingsRequest,
  SearchListingsResponse,
  UpdateListingRequest,
} from "typespec/orgs/marketplace/listings";
import type {
  GetActivityStatementRequest,
  GetActivityStatementResponse,
} from "typespec/orgs/marketplace/statements";
import type {
  InterviewReference,
  JobDetail,
  JobReference,
  ListJobsRequest,
  ListJobsResponse,
  ListWorkQueueRequest,
  ListWorkQueueResponse,
  RecordAssessmentRequest,
  ChangeInterviewRequest as WorkChangeInterviewRequest,
  WorkDetail,
  RecordBackgroundCheckResultRequest as WorkRecordBackgroundCheckResultRequest,
  RecordInterviewOutcomeRequest as WorkRecordInterviewOutcomeRequest,
  WorkReference,
  ScheduleInterviewRequest as WorkScheduleInterviewRequest,
  SubmitInterviewFeedbackRequest as WorkSubmitInterviewFeedbackRequest,
  WriteResult,
} from "typespec/orgs/marketplace/work/work";
import type {
  CreateOpeningRequest,
  DecideOpeningRequestRequest,
  DiscardOpeningRequest,
  DiscardOpeningWorkingCopyRequest,
  DuplicateOpeningRequest,
  GetOpeningRequest,
  ListOpeningHistoryRequest,
  ListOpeningHistoryResponse,
  ListOpeningsRequest,
  ListOpeningsResponse,
  LookupOpeningTeamMemberRequest,
  LookupOpeningTeamMemberResponse,
  OpeningSummaryResponse,
  RequestOpeningChangeRequest,
  SaveOpeningWorkingCopyRequest,
  SetOpeningTeamRequest,
  WithdrawOpeningRequestRequest,
} from "typespec/orgs/openings/openings";
import type {
  GetOpeningPipelineRequest,
  OpeningPipeline,
  ReplaceOpeningPipelineRequest,
} from "typespec/orgs/openings/pipeline";
import type { OrgOpening } from "typespec/orgs/openings/types";
import type { SetCompanyDetailsRequest } from "typespec/orgs/settings/company";
import type { SetGoogleSignInRequest } from "typespec/orgs/settings/google_sign_in";
import type { LogoContentType } from "typespec/orgs/settings/logo";
import type {
  OrgSubscription,
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
  listPipelineTemplates: (body: ListPipelineTemplatesRequest) =>
    apiRequest<ListPipelineTemplatesResponse>("/list-pipeline-templates", {
      body,
    }),
  createPipelineTemplate: (
    body: CreatePipelineTemplateRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<PipelineTemplate>("/create-pipeline-template", {
      body,
      idempotencyKey,
    }),
  updatePipelineTemplate: (
    body: UpdatePipelineTemplateRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<PipelineTemplate>("/update-pipeline-template", {
      body,
      idempotencyKey,
    }),
  deletePipelineTemplate: (
    body: DeletePipelineTemplateRequest,
    idempotencyKey: IdempotencyKey,
  ) => apiRequest<void>("/delete-pipeline-template", { body, idempotencyKey }),
  getOpeningPipeline: (body: GetOpeningPipelineRequest) =>
    apiRequest<OpeningPipeline>("/get-opening-pipeline", { body }),
  replaceOpeningPipeline: (
    body: ReplaceOpeningPipelineRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<OpeningPipeline>("/replace-opening-pipeline", {
      body,
      idempotencyKey,
    }),
  getApplicationCounts: (body: GetApplicationCountsRequest) =>
    apiRequest<ApplicationCounts>("/get-application-counts", { body }),
  listApplications: (body: ListApplicationsRequest) =>
    apiRequest<ListApplicationsResponse>("/list-applications", { body }),
  getApplication: (body: GetApplicationRequest) =>
    apiRequest<ApplicationDetail>("/get-application", { body }),
  listApplicationHistory: (body: ListApplicationHistoryRequest) =>
    apiRequest<ListApplicationHistoryResponse>("/list-application-history", {
      body,
    }),
  shortlistApplication: (
    body: ApplicationStageRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/shortlist-application", {
      body,
      idempotencyKey,
    }),
  moveApplicationStage: (
    body: ApplicationStageRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/move-application-stage", {
      body,
      idempotencyKey,
    }),
  completeApplicationStage: (
    body: ApplicationActionRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/complete-application-stage", {
      body,
      idempotencyKey,
    }),
  markApplicationNotProgressing: (
    body: ApplicationActionRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/mark-application-not-progressing", {
      body,
      idempotencyKey,
    }),
  recordApplicationJoined: (
    body: ApplicationJoinedOnRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/record-application-joined", {
      body,
      idempotencyKey,
    }),
  recordApplicationDidNotJoin: (
    body: ApplicationActionRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/record-application-did-not-join", {
      body,
      idempotencyKey,
    }),
  recordApplicationSeparated: (
    body: ApplicationSeparatedOnRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/record-application-separated", {
      body,
      idempotencyKey,
    }),
  correctApplicationJoinedOn: (
    body: ApplicationJoinedOnRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/correct-application-joined-on", {
      body,
      idempotencyKey,
    }),
  correctApplicationSeparatedOn: (
    body: ApplicationSeparatedOnRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/correct-application-separated-on", {
      body,
      idempotencyKey,
    }),
  uploadOfferLetter: (letter: Blob, idempotencyKey: IdempotencyKey) =>
    apiRequest<OfferLetterUploaded>("/upload-offer-letter", {
      body: letter,
      contentType: "application/pdf",
      idempotencyKey,
    }),
  extendApplicationOffer: (
    body: ExtendApplicationOfferRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/extend-application-offer", {
      body,
      idempotencyKey,
    }),
  withdrawApplicationOffer: (
    body: ApplicationActionRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/withdraw-application-offer", {
      body,
      idempotencyKey,
    }),
  scheduleInterview: (
    body: ScheduleInterviewRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/schedule-interview", {
      body,
      idempotencyKey,
    }),
  changeInterview: (
    body: ChangeInterviewRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/change-interview", {
      body,
      idempotencyKey,
    }),
  cancelInterview: (
    body: CancelInterviewRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/cancel-interview", {
      body,
      idempotencyKey,
    }),
  recordInterviewOutcome: (
    body: RecordInterviewOutcomeRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/record-interview-outcome", {
      body,
      idempotencyKey,
    }),
  submitInterviewFeedback: (
    body: SubmitInterviewFeedbackRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/submit-interview-feedback", {
      body,
      idempotencyKey,
    }),
  recordAssessmentResult: (
    body: RecordAssessmentResultRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/record-assessment-result", {
      body,
      idempotencyKey,
    }),
  requestBackgroundCheckConsent: (
    body: RequestBackgroundCheckConsentRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/request-background-check-consent", {
      body,
      idempotencyKey,
    }),
  recordBackgroundCheckResult: (
    body: RecordBackgroundCheckResultRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/record-background-check-result", {
      body,
      idempotencyKey,
    }),
  listMyInterviews: (body: ListMyInterviewsRequest) =>
    apiRequest<ListMyInterviewsResponse>("/list-my-interviews", { body }),
  createOpening: (body: CreateOpeningRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<OrgOpening>("/create-opening", { body, idempotencyKey }),
  duplicateOpening: (
    body: DuplicateOpeningRequest,
    idempotencyKey: IdempotencyKey,
  ) => apiRequest<OrgOpening>("/duplicate-opening", { body, idempotencyKey }),
  getOpening: (body: GetOpeningRequest) =>
    apiRequest<OrgOpening>("/get-opening", { body }),
  listOpenings: (body: ListOpeningsRequest) =>
    apiRequest<ListOpeningsResponse>("/list-openings", { body }),
  openingSummary: () =>
    apiRequest<OpeningSummaryResponse>("/opening-summary", { body: {} }),
  lookupOpeningTeamMember: (body: LookupOpeningTeamMemberRequest) =>
    apiRequest<LookupOpeningTeamMemberResponse>("/lookup-opening-team-member", {
      body,
    }),
  saveOpeningWorkingCopy: (
    body: SaveOpeningWorkingCopyRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<OrgOpening>("/save-opening-working-copy", {
      body,
      idempotencyKey,
    }),
  discardOpeningWorkingCopy: (
    body: DiscardOpeningWorkingCopyRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<OrgOpening>("/discard-opening-working-copy", {
      body,
      idempotencyKey,
    }),
  setOpeningTeam: (
    body: SetOpeningTeamRequest,
    idempotencyKey: IdempotencyKey,
  ) => apiRequest<OrgOpening>("/set-opening-team", { body, idempotencyKey }),
  discardOpening: (
    body: DiscardOpeningRequest,
    idempotencyKey: IdempotencyKey,
  ) => apiRequest<OrgOpening>("/discard-opening", { body, idempotencyKey }),
  requestOpeningChange: (
    body: RequestOpeningChangeRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<OrgOpening>("/request-opening-change", { body, idempotencyKey }),
  decideOpeningRequest: (
    body: DecideOpeningRequestRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<OrgOpening>("/decide-opening-request", { body, idempotencyKey }),
  withdrawOpeningRequest: (
    body: WithdrawOpeningRequestRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<OrgOpening>("/withdraw-opening-request", {
      body,
      idempotencyKey,
    }),
  listOpeningHistory: (body: ListOpeningHistoryRequest) =>
    apiRequest<ListOpeningHistoryResponse>("/list-opening-history", { body }),
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
  setCompanyDetails: (body: SetCompanyDetailsRequest) =>
    apiRequest<void>("/set-company-details", { body }),
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
  getAIOptions: (body: GetAIOptionsRequest) =>
    apiRequest<AIOptions>("/get-ai-options", { body }),
  aiSettings: () => apiRequest<AISettingsResponse>("/ai-settings"),
  setAISettings: (body: SetAISettingsRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<AISettingsResponse>("/set-ai-settings", {
      body,
      idempotencyKey,
    }),
  aiCredits: () => apiRequest<AICreditsResponse>("/ai-credits"),
  listAICreditLots: (body: ListAICreditLotsRequest) =>
    apiRequest<ListAICreditLotsResponse>("/list-ai-credit-lots", { body }),
  buyAICreditPack: (
    body: BuyAICreditPackRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<AICreditsResponse>("/buy-ai-credit-pack", {
      body,
      idempotencyKey,
    }),
  listAIUsage: (body: ListAIUsageRequest) =>
    apiRequest<ListAIUsageResponse>("/list-ai-usage", { body }),
  getAIUsageText: (body: GetAIUsageTextRequest) =>
    apiRequest<AIUsageText>("/get-ai-usage-text", { body }),
  draftOpeningWithAI: (
    body: DraftOpeningRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<DraftOpeningResponse>("/draft-opening-with-ai", {
      body,
      idempotencyKey,
    }),
  searchListings: (body: SearchListingsRequest) =>
    apiRequest<SearchListingsResponse>("/search-listings", { body }),
  getListing: (body: GetListingRequest) =>
    apiRequest<ListingDetail>("/get-listing", { body }),
  listEngagements: (body: ListEngagementsRequest) =>
    apiRequest<ListEngagementsResponse>("/list-engagements", { body }),
  getEngagement: (body: GetEngagementRequest) =>
    apiRequest<Engagement>("/get-engagement", { body }),
  proposeEngagement: (
    body: ProposeEngagementRequest,
    idempotencyKey: IdempotencyKey,
  ) => apiRequest<Engagement>("/propose-engagement", { body, idempotencyKey }),
  withdrawEngagement: (
    body: EngagementTarget,
    idempotencyKey: IdempotencyKey,
  ) => apiRequest<Engagement>("/withdraw-engagement", { body, idempotencyKey }),
  endEngagement: (body: EndEngagementRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<Engagement>("/end-engagement", { body, idempotencyKey }),
  setEngagementReference: (
    body: SetEngagementReferenceRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<Engagement>("/set-engagement-reference", {
      body,
      idempotencyKey,
    }),
  getEngagementStatement: (body: GetActivityStatementRequest) =>
    apiRequest<GetActivityStatementResponse>("/get-engagement-statement", {
      body,
    }),
  getOpeningProviders: (body: GetOpeningProvidersRequest) =>
    apiRequest<OpeningProviders>("/get-opening-providers", { body }),
  assignOpeningProvider: (
    body: AssignOpeningProviderRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<OpeningProviders>("/assign-opening-provider", {
      body,
      idempotencyKey,
    }),
  unassignOpeningProvider: (
    body: UnassignOpeningProviderRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<OpeningProviders>("/unassign-opening-provider", {
      body,
      idempotencyKey,
    }),
  routeApplication: (
    body: RouteApplicationRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ApplicationDetail>("/route-application", {
      body,
      idempotencyKey,
    }),
  listListings: () =>
    apiRequest<ListListingsResponse>("/list-listings", { body: {} }),
  createListing: (body: CreateListingRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<Listing>("/create-listing", { body, idempotencyKey }),
  updateListing: (body: UpdateListingRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<Listing>("/update-listing", { body, idempotencyKey }),
  publishListing: (body: ListingTarget, idempotencyKey: IdempotencyKey) =>
    apiRequest<Listing>("/publish-listing", { body, idempotencyKey }),
  unlistListing: (body: ListingTarget, idempotencyKey: IdempotencyKey) =>
    apiRequest<Listing>("/unlist-listing", { body, idempotencyKey }),
  deleteListing: (body: ListingTarget, idempotencyKey: IdempotencyKey) =>
    apiRequest<void>("/delete-listing", { body, idempotencyKey }),
  listClientEngagements: (body: ListEngagementsRequest) =>
    apiRequest<ListEngagementsResponse>("/list-client-engagements", { body }),
  getClientEngagement: (body: GetEngagementRequest) =>
    apiRequest<Engagement>("/get-client-engagement", { body }),
  getClientEngagementStatement: (body: GetActivityStatementRequest) =>
    apiRequest<GetActivityStatementResponse>(
      "/get-client-engagement-statement",
      { body },
    ),
  acceptEngagement: (body: EngagementTarget, idempotencyKey: IdempotencyKey) =>
    apiRequest<Engagement>("/accept-engagement", { body, idempotencyKey }),
  declineEngagement: (body: EngagementTarget, idempotencyKey: IdempotencyKey) =>
    apiRequest<Engagement>("/decline-engagement", { body, idempotencyKey }),
  endClientEngagement: (
    body: EndEngagementRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<Engagement>("/end-client-engagement", { body, idempotencyKey }),
  setClientEngagementReference: (
    body: SetEngagementReferenceRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<Engagement>("/set-client-engagement-reference", {
      body,
      idempotencyKey,
    }),
  listWorkQueue: (body: ListWorkQueueRequest) =>
    apiRequest<ListWorkQueueResponse>("/list-work-queue", { body }),
  getWorkItem: (body: WorkReference) =>
    apiRequest<WorkDetail>("/get-work-item", { body }),
  scheduleWorkInterview: (
    body: WorkScheduleInterviewRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<WriteResult>("/schedule-work-interview", {
      body,
      idempotencyKey,
    }),
  changeWorkInterview: (
    body: WorkChangeInterviewRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<WriteResult>("/change-work-interview", {
      body,
      idempotencyKey,
    }),
  cancelWorkInterview: (
    body: InterviewReference,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<WriteResult>("/cancel-work-interview", {
      body,
      idempotencyKey,
    }),
  recordWorkInterviewOutcome: (
    body: WorkRecordInterviewOutcomeRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<WriteResult>("/record-work-interview-outcome", {
      body,
      idempotencyKey,
    }),
  submitWorkInterviewFeedback: (
    body: WorkSubmitInterviewFeedbackRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<WriteResult>("/submit-work-interview-feedback", {
      body,
      idempotencyKey,
    }),
  recordWorkAssessment: (
    body: RecordAssessmentRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<WriteResult>("/record-work-assessment", {
      body,
      idempotencyKey,
    }),
  recordWorkBackgroundCheckResult: (
    body: WorkRecordBackgroundCheckResultRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<WriteResult>("/record-work-background-check-result", {
      body,
      idempotencyKey,
    }),
  listJobs: (body: ListJobsRequest = {}) =>
    apiRequest<ListJobsResponse>("/list-jobs", { body }),
  getJob: (body: JobReference) => apiRequest<JobDetail>("/get-job", { body }),
  listCreditedApplications: (body: ListCreditedApplicationsRequest = {}) =>
    apiRequest<ListCreditedApplicationsResponse>(
      "/list-credited-applications",
      {
        body,
      },
    ),
  listContacts: (body: ListContactsRequest = {}) =>
    apiRequest<ListContactsResponse>("/list-contacts", { body }),
  getContact: (body: ContactReference) =>
    apiRequest<Contact>("/get-contact", { body }),
  viewHubProfile: (body: ViewHubProfileRequest) =>
    apiRequest<AgencyProfile>("/view-hub-profile", { body }),
  listContactNotes: (body: ListContactNotesRequest) =>
    apiRequest<ListContactNotesResponse>("/list-contact-notes", { body }),
  addPersonNote: (body: AddPersonNoteRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<AddedNote>("/add-person-note", {
      body,
      idempotencyKey,
    }),
  addContactNote: (
    body: AddContactNoteRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<AddedNote>("/add-contact-note", {
      body,
      idempotencyKey,
    }),
  editContactNote: (
    body: EditContactNoteRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<AddedNote>("/edit-contact-note", {
      body,
      idempotencyKey,
    }),
  deleteContactNote: (
    body: DeleteContactNoteRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<DeletedNote>("/delete-contact-note", {
      body,
      idempotencyKey,
    }),
  startConversation: (
    body: StartConversationRequest,
    idempotencyKey: IdempotencyKey,
  ) =>
    apiRequest<ConversationDetail>("/start-conversation", {
      body,
      idempotencyKey,
    }),
  sendMessage: (body: SendMessageRequest, idempotencyKey: IdempotencyKey) =>
    apiRequest<ConversationMessage>("/send-message", {
      body,
      idempotencyKey,
    }),
  getConversation: (body: GetConversationRequest) =>
    apiRequest<ConversationDetail>("/get-conversation", { body }),
  markConversationRead: (body: MarkConversationReadRequest) =>
    apiRequest<void>("/mark-conversation-read", { body }),
};
