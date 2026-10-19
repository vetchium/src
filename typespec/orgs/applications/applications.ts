import {
  type EmailAddress,
  isEmailAddress,
  normalizeEmailAddress,
} from "../../common/common.ts";
import type { CountryCode, DisplayName } from "../../common/localization.ts";
import type { PageSize, PaginationKey } from "../../common/pagination.ts";
import { isPageSize, isPaginationKey } from "../../common/pagination.ts";
import {
  isWebsiteURL,
  normalizeWebsiteURL,
  type WebsiteURL,
} from "../../hub/profile/public.ts";
import type { ApplicantSnapshot } from "../../hub/profile/snapshot.ts";
import type { PipelineStage, PipelineStageID } from "../hiring/pipelines.ts";
import { isPipelineStageID } from "../hiring/pipelines.ts";
import { type CheckType, isCheckType } from "../hiring/vocabulary.ts";
import type { OpeningNumber } from "../openings/types.ts";

/** The most code points an application's cover note holds. */
export const maxCoverNote = 5000;
const minNameQuery = 2;
const maxNameQuery = 100;
const maxStateCount = 8;

export type ApplicationNumber = number;
export type ApplicationVersion = number;
export type ApplicationCoverNote = string;
export type ApplicantNameQuery = string;
export type OfferLetterID = string;
export type OfferNumber = number;
export type OfferResponseDays = number;
export type InterviewNumber = number;
export type InterviewDurationMinutes = number;
export type InterviewLocation = string;
export type InterviewRescheduleNote = string;
export type InterviewFeedbackNotes = string;
export type AssessmentScore = number;
export type ResultNotes = string;
export type BackgroundCheckNumber = number;

/** The most code points the notes of an assessment or a check hold. */
export const maxResultNotes = 2000;
export const maxAssessmentScore = 100;
/** The most check types one consent request names. */
export const maxCheckTypes = 20;

/** The most interviews one candidacy holds at one stage, cancelled excepted. */
export const maxInterviewsPerStage = 10;
/** The most interviewers of one interview. */
export const maxInterviewers = 10;
export const maxInterviewLocation = 500;
export const maxRescheduleNote = 500;
export const maxFeedbackNotes = 10000;
const minInterviewDuration = 15;
const maxInterviewDuration = 480;

export const interviewModeValues = ["video", "in_person"] as const;
export type InterviewMode = (typeof interviewModeValues)[number];

export const interviewStateValues = [
  "scheduled",
  "completed",
  "no_show",
  "cancelled",
] as const;
export type InterviewState = (typeof interviewStateValues)[number];

export const interviewResponseValues = [
  "pending",
  "accepted",
  "reschedule_requested",
] as const;
export type InterviewResponse = (typeof interviewResponseValues)[number];

export const interviewRecommendationValues = [
  "strong_yes",
  "yes",
  "no",
  "strong_no",
] as const;
export type InterviewRecommendation =
  (typeof interviewRecommendationValues)[number];

export const interviewOutcomeValues = ["completed", "no_show"] as const;
export type InterviewOutcome = (typeof interviewOutcomeValues)[number];

export const assessmentOutcomeValues = [
  "pass",
  "fail",
  "inconclusive",
] as const;
export type AssessmentOutcome = (typeof assessmentOutcomeValues)[number];

export const checkOutcomeValues = [
  "clear",
  "discrepancy",
  "unable_to_verify",
] as const;
export type CheckOutcome = (typeof checkOutcomeValues)[number];

export const consentStateValues = [
  "requested",
  "given",
  "declined",
  "ended",
] as const;
export type ConsentState = (typeof consentStateValues)[number];

export const workPerformerValues = ["org"] as const;
export type WorkPerformer = (typeof workPerformerValues)[number];

export const pendingApplicantActionValues = [
  "interview_response",
  "background_check_consent",
  "offer_response",
] as const;
export type PendingApplicantAction =
  (typeof pendingApplicantActionValues)[number];

const interviewModes = new Set<string>(interviewModeValues);
const interviewStates = new Set<string>(interviewStateValues);
const interviewResponses = new Set<string>(interviewResponseValues);
const interviewRecommendations = new Set<string>(interviewRecommendationValues);
const interviewOutcomes = new Set<string>(interviewOutcomeValues);
const pendingApplicantActions = new Set<string>(pendingApplicantActionValues);
const assessmentOutcomes = new Set<string>(assessmentOutcomeValues);
const checkOutcomes = new Set<string>(checkOutcomeValues);
const consentStates = new Set<string>(consentStateValues);
const workPerformers = new Set<string>(workPerformerValues);

export function isAssessmentOutcome(
  value: unknown,
): value is AssessmentOutcome {
  return typeof value === "string" && assessmentOutcomes.has(value);
}

export function isCheckOutcome(value: unknown): value is CheckOutcome {
  return typeof value === "string" && checkOutcomes.has(value);
}

export function isConsentState(value: unknown): value is ConsentState {
  return typeof value === "string" && consentStates.has(value);
}

export function isWorkPerformer(value: unknown): value is WorkPerformer {
  return typeof value === "string" && workPerformers.has(value);
}

export function isAssessmentScore(value: AssessmentScore): boolean {
  return Number.isInteger(value) && value >= 0 && value <= maxAssessmentScore;
}

export function isBackgroundCheckNumber(value: BackgroundCheckNumber): boolean {
  return Number.isInteger(value) && value >= 1;
}

export function isInterviewMode(value: unknown): value is InterviewMode {
  return typeof value === "string" && interviewModes.has(value);
}

export function isInterviewState(value: unknown): value is InterviewState {
  return typeof value === "string" && interviewStates.has(value);
}

export function isInterviewResponse(
  value: unknown,
): value is InterviewResponse {
  return typeof value === "string" && interviewResponses.has(value);
}

export function isInterviewRecommendation(
  value: unknown,
): value is InterviewRecommendation {
  return typeof value === "string" && interviewRecommendations.has(value);
}

export function isInterviewOutcome(value: unknown): value is InterviewOutcome {
  return typeof value === "string" && interviewOutcomes.has(value);
}

export function isPendingApplicantAction(
  value: unknown,
): value is PendingApplicantAction {
  return typeof value === "string" && pendingApplicantActions.has(value);
}

export function isInterviewNumber(value: InterviewNumber): boolean {
  return Number.isInteger(value) && value >= 1;
}

export function isInterviewDurationMinutes(
  value: InterviewDurationMinutes,
): boolean {
  return (
    Number.isInteger(value) &&
    value >= minInterviewDuration &&
    value <= maxInterviewDuration
  );
}

function trimmedText(value: string, max: number): boolean {
  const length = Array.from(value).length;
  return length >= 1 && length <= max && value === value.trim();
}

/** Reports a trimmed place of 1 to 500 code points. */
export function isInterviewLocation(value: InterviewLocation): boolean {
  return trimmedText(value, maxInterviewLocation);
}

/** Reports a trimmed note of 1 to 500 code points. */
export function isInterviewRescheduleNote(
  value: InterviewRescheduleNote,
): boolean {
  return trimmedText(value, maxRescheduleNote);
}

/** Reports trimmed notes of 1 to 2,000 code points. */
export function isResultNotes(value: ResultNotes): boolean {
  return trimmedText(value, maxResultNotes);
}

/** Reports trimmed notes of 1 to 10,000 code points. */
export function isInterviewFeedbackNotes(
  value: InterviewFeedbackNotes,
): boolean {
  return trimmedText(value, maxFeedbackNotes);
}

/** The most bytes an offer letter's PDF body holds. */
export const maxOfferLetterBytes = 5 * 1024 * 1024;
/** The only type an offer letter is uploaded as. */
export const offerLetterContentType = "application/pdf" as const;
const minOfferResponseDays = 1;
const maxOfferResponseDays = 60;

export const offerStatusValues = [
  "extended",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
] as const;

export type OfferStatus = (typeof offerStatusValues)[number];

const offerStatuses = new Set<string>(offerStatusValues);

export function isOfferStatus(value: unknown): value is OfferStatus {
  return typeof value === "string" && offerStatuses.has(value);
}

export function isOfferNumber(value: OfferNumber): boolean {
  return Number.isInteger(value) && value >= 1;
}

export function isOfferResponseDays(value: OfferResponseDays): boolean {
  return (
    Number.isInteger(value) &&
    value >= minOfferResponseDays &&
    value <= maxOfferResponseDays
  );
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reports whether body starts with the PDF signature `%PDF-`. */
export function isPDF(body: Uint8Array): boolean {
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return (
    body.length >= signature.length &&
    signature.every((byte, index) => body[index] === byte)
  );
}

/** Accepts the lowercase form the API returns. */
export function isOfferLetterID(value: OfferLetterID): boolean {
  return uuidPattern.test(value);
}

export const applicationStateValues = [
  "submitted",
  "in_pipeline",
  "offered",
  "offer_accepted",
  "offer_declined",
  "joined",
  "did_not_join",
  "not_progressing",
  "withdrawn",
] as const;

export type ApplicationState = (typeof applicationStateValues)[number];

export const ApplicantsView = "applicants" as const;
export const CandidatesView = "candidates" as const;
export type ApplicationView = typeof ApplicantsView | typeof CandidatesView;

export const stageStatusValues = ["pending", "completed", "skipped"] as const;

export type StageStatus = (typeof stageStatusValues)[number];

/** A `YYYY-MM-DD` date with no time or zone. */
export type CalendarDate = string;

export function isCalendarDate(value: CalendarDate): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

export const applicationHistoryActionValues = [
  "applied",
  "shortlisted",
  "stage_moved",
  "offer_extended",
  "offer_withdrawn",
  "offer_accepted",
  "offer_declined",
  "joined",
  "did_not_join",
  "not_progressing",
  "withdrawn",
  "stage_completed",
  "separated",
  "joined_corrected",
  "separated_corrected",
  "interview_scheduled",
  "interview_changed",
  "interview_cancelled",
  "interview_completed",
  "interview_no_show",
  "interview_accepted",
  "interview_reschedule_requested",
  "interview_feedback_submitted",
  "assessment_recorded",
  "background_check_consent_requested",
  "background_check_consent_given",
  "background_check_consent_declined",
  "background_check_result_recorded",
] as const;

export type ApplicationHistoryAction =
  (typeof applicationHistoryActionValues)[number];

export const applicationActorKindValues = [
  "applicant",
  "org_user",
  "system",
] as const;

export type ApplicationActorKind = (typeof applicationActorKindValues)[number];

const applicationStates = new Set<string>(applicationStateValues);
const stageStatuses = new Set<string>(stageStatusValues);

export function isApplicationState(value: unknown): value is ApplicationState {
  return typeof value === "string" && applicationStates.has(value);
}

export function isApplicationView(value: unknown): value is ApplicationView {
  return value === ApplicantsView || value === CandidatesView;
}

export function isStageStatus(value: unknown): value is StageStatus {
  return typeof value === "string" && stageStatuses.has(value);
}

/**
 * Reports whether an application in `state` is a candidate: shortlisted and
 * neither finished nor ended.
 */
export function isCandidacy(state: ApplicationState): boolean {
  return (
    state === "in_pipeline" || state === "offered" || state === "offer_accepted"
  );
}

export function isApplicationNumber(value: ApplicationNumber): boolean {
  return Number.isInteger(value) && value >= 1;
}

export function isApplicationCoverNote(value: ApplicationCoverNote): boolean {
  const length = Array.from(value).length;
  return length >= 1 && length <= maxCoverNote;
}

export function normalizeApplicantNameQuery(
  value: ApplicantNameQuery,
): ApplicantNameQuery {
  return value.trim();
}

/** Reports a trimmed query of 2 to 100 code points. */
export function isApplicantNameQuery(value: ApplicantNameQuery): boolean {
  const length = Array.from(value).length;
  return (
    length >= minNameQuery &&
    length <= maxNameQuery &&
    value === normalizeApplicantNameQuery(value)
  );
}

export interface ApplicationSummary {
  application_number: ApplicationNumber;
  state: ApplicationState;
  version: ApplicationVersion;
  display_name: DisplayName;
  resident_country: CountryCode;
  current_stage?: PipelineStage;
  submitted_at: string;
  updated_at: string;
}

export interface ApplicationStageRecord {
  stage: PipelineStage;
  status: StageStatus;
}

export interface ApplicationOffer {
  offer_number: OfferNumber;
  status: OfferStatus;
  letter_url: string;
  letter_byte_size: number;
  proposed_joining_date?: CalendarDate;
  respond_by: string;
  extended_at: string;
  ended_at?: string;
}

export interface InterviewerStatus {
  email: EmailAddress;
  feedback_submitted: boolean;
}

export interface InterviewFeedback {
  interviewer_email: EmailAddress;
  recommendation: InterviewRecommendation;
  notes: InterviewFeedbackNotes;
  submitted_at: string;
}

/**
 * One interview as the caller may see it: `feedback` holds the caller's own
 * and, unless the caller is an interviewer who has not submitted theirs,
 * everyone's.
 */
export interface Interview {
  interview_number: InterviewNumber;
  stage: PipelineStage;
  starts_at: string;
  duration_minutes: InterviewDurationMinutes;
  mode: InterviewMode;
  video_url?: string;
  location?: InterviewLocation;
  state: InterviewState;
  applicant_response: InterviewResponse;
  reschedule_note?: InterviewRescheduleNote;
  interviewers: InterviewerStatus[];
  feedback: InterviewFeedback[];
}

/** The recorded result of an assessment stage. */
export interface AssessmentResult {
  stage: PipelineStage;
  outcome: AssessmentOutcome;
  score?: AssessmentScore;
  notes?: ResultNotes;
  report_url?: WebsiteURL;
  recorded_by_email?: EmailAddress;
  recorded_at: string;
}

/** What one background check found. */
export interface BackgroundCheckResult {
  check_type: CheckType;
  outcome: CheckOutcome;
  notes?: ResultNotes;
  report_url?: WebsiteURL;
  recorded_by_email?: EmailAddress;
  recorded_at: string;
}

/**
 * One consent request at a background-check stage with the results recorded
 * after consent.
 */
export interface BackgroundCheck {
  check_number: BackgroundCheckNumber;
  stage: PipelineStage;
  consent_state: ConsentState;
  check_types: CheckType[];
  performer: WorkPerformer;
  requested_at: string;
  responded_at?: string;
  results: BackgroundCheckResult[];
}

export interface ApplicationDetail {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
  state: ApplicationState;
  version: ApplicationVersion;
  snapshot: ApplicantSnapshot;
  cover_note?: ApplicationCoverNote;
  current_stage?: PipelineStage;
  stage_records: ApplicationStageRecord[];
  joined_on?: CalendarDate;
  separated_on?: CalendarDate;
  positions: number;
  joined_count: number;
  offers: ApplicationOffer[];
  interviews: Interview[];
  assessments: AssessmentResult[];
  background_checks: BackgroundCheck[];
  submitted_at: string;
  updated_at: string;
}

export interface ApplicationHistoryEntry {
  action: ApplicationHistoryAction;
  actor: ApplicationActorKind;
  actor_email?: EmailAddress;
  state: ApplicationState;
  version: ApplicationVersion;
  stage?: PipelineStage;
  joined_on?: CalendarDate;
  separated_on?: CalendarDate;
  /** The interview an interview action concerns. */
  interview_number?: InterviewNumber;
  created_at: string;
}

export interface ApplicationStateCount {
  state: ApplicationState;
  count: number;
}

export interface StageApplicationCount {
  stage: PipelineStage;
  count: number;
}

export interface ApplicationCounts {
  opening_number: OpeningNumber;
  states: ApplicationStateCount[];
  stages: StageApplicationCount[];
}

export interface ListApplicationsRequest {
  opening_number: OpeningNumber;
  view: ApplicationView;
  states?: ApplicationState[];
  stage_id?: PipelineStageID;
  name_query?: ApplicantNameQuery;
  /** Candidates view only. */
  pending_applicant_action?: PendingApplicantAction;
  pagination_key?: PaginationKey;
  limit?: PageSize;
}

export function normalizeListApplicationsRequest(
  request: ListApplicationsRequest,
): ListApplicationsRequest {
  return request.name_query === undefined
    ? request
    : {
        ...request,
        name_query: normalizeApplicantNameQuery(request.name_query),
      };
}

export function effectiveListApplicationsLimit(
  request: ListApplicationsRequest,
): PageSize {
  return request.limit ?? 50;
}

export function validateListApplicationsRequest(
  request: ListApplicationsRequest,
): string[] {
  const fields: string[] = [];
  if (!isApplicationNumber(request.opening_number)) {
    fields.push("opening_number");
  }
  const viewValid = isApplicationView(request.view);
  if (!viewValid) fields.push("view");
  // The Applicants view is exactly the `submitted` applications, so the
  // candidacy filters have nothing to select there.
  const candidates = viewValid && request.view === CandidatesView;
  if (request.states !== undefined) {
    const seen = new Set<string>();
    let valid =
      candidates &&
      request.states.length >= 1 &&
      request.states.length <= maxStateCount;
    for (const state of request.states) {
      if (
        !isApplicationState(state) ||
        state === "submitted" ||
        seen.has(state)
      ) {
        valid = false;
      }
      seen.add(state);
    }
    if (!valid) fields.push("states");
  }
  if (
    request.stage_id !== undefined &&
    (!candidates || !isPipelineStageID(request.stage_id))
  ) {
    fields.push("stage_id");
  }
  if (
    request.name_query !== undefined &&
    !isApplicantNameQuery(request.name_query)
  ) {
    fields.push("name_query");
  }
  if (
    request.pending_applicant_action !== undefined &&
    (!candidates || !isPendingApplicantAction(request.pending_applicant_action))
  ) {
    fields.push("pending_applicant_action");
  }
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  ) {
    fields.push("pagination_key");
  }
  if (request.limit !== undefined && !isPageSize(request.limit)) {
    fields.push("limit");
  }
  return fields;
}

export interface ListApplicationsResponse {
  applications: ApplicationSummary[];
  next_pagination_key?: PaginationKey;
}

export interface GetApplicationRequest {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
}

function validateNumbers(
  opening: OpeningNumber,
  application: ApplicationNumber,
): string[] {
  const fields: string[] = [];
  if (!isApplicationNumber(opening)) fields.push("opening_number");
  if (!isApplicationNumber(application)) fields.push("application_number");
  return fields;
}

export function validateGetApplicationRequest(
  request: GetApplicationRequest,
): string[] {
  return validateNumbers(request.opening_number, request.application_number);
}

export interface GetApplicationCountsRequest {
  opening_number: OpeningNumber;
}

export function validateGetApplicationCountsRequest(
  request: GetApplicationCountsRequest,
): string[] {
  return isApplicationNumber(request.opening_number) ? [] : ["opening_number"];
}

export interface ListApplicationHistoryRequest {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
  pagination_key?: PaginationKey;
  limit?: PageSize;
}

export function effectiveListApplicationHistoryLimit(
  request: ListApplicationHistoryRequest,
): PageSize {
  return request.limit ?? 50;
}

export function validateListApplicationHistoryRequest(
  request: ListApplicationHistoryRequest,
): string[] {
  const fields = validateNumbers(
    request.opening_number,
    request.application_number,
  );
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  ) {
    fields.push("pagination_key");
  }
  if (request.limit !== undefined && !isPageSize(request.limit)) {
    fields.push("limit");
  }
  return fields;
}

export interface ListApplicationHistoryResponse {
  entries: ApplicationHistoryEntry[];
  next_pagination_key?: PaginationKey;
}

export interface ApplicationActionRequest {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
  version: ApplicationVersion;
}

export function validateApplicationActionRequest(
  request: ApplicationActionRequest,
): string[] {
  const fields = validateNumbers(
    request.opening_number,
    request.application_number,
  );
  if (!isApplicationNumber(request.version)) fields.push("version");
  return fields;
}

export interface ApplicationStageRequest extends ApplicationActionRequest {
  stage_id: PipelineStageID;
}

export function validateApplicationStageRequest(
  request: ApplicationStageRequest,
): string[] {
  const fields = validateApplicationActionRequest(request);
  if (!isPipelineStageID(request.stage_id)) fields.push("stage_id");
  return fields;
}

export interface ApplicationJoinedOnRequest extends ApplicationActionRequest {
  joined_on: CalendarDate;
}

export function validateApplicationJoinedOnRequest(
  request: ApplicationJoinedOnRequest,
): string[] {
  const fields = validateApplicationActionRequest(request);
  if (!isCalendarDate(request.joined_on)) fields.push("joined_on");
  return fields;
}

export interface ApplicationSeparatedOnRequest
  extends ApplicationActionRequest {
  separated_on: CalendarDate;
}

export function validateApplicationSeparatedOnRequest(
  request: ApplicationSeparatedOnRequest,
): string[] {
  const fields = validateApplicationActionRequest(request);
  if (!isCalendarDate(request.separated_on)) fields.push("separated_on");
  return fields;
}

export interface ExtendApplicationOfferRequest
  extends ApplicationActionRequest {
  letter_id: OfferLetterID;
  proposed_joining_date?: CalendarDate;
  respond_within_days: OfferResponseDays;
}

export function validateExtendApplicationOfferRequest(
  request: ExtendApplicationOfferRequest,
): string[] {
  const fields = validateApplicationActionRequest(request);
  if (!isOfferLetterID(request.letter_id)) fields.push("letter_id");
  if (
    request.proposed_joining_date !== undefined &&
    !isCalendarDate(request.proposed_joining_date)
  ) {
    fields.push("proposed_joining_date");
  }
  if (!isOfferResponseDays(request.respond_within_days)) {
    fields.push("respond_within_days");
  }
  return fields;
}

export interface OfferLetterUploaded {
  letter_id: OfferLetterID;
}

export interface InterviewDetails {
  start_time: string;
  duration_minutes: InterviewDurationMinutes;
  mode: InterviewMode;
  video_url?: WebsiteURL;
  location?: InterviewLocation;
  interviewer_emails: EmailAddress[];
}

function normalizeInterviewDetails<T extends InterviewDetails>(request: T): T {
  const parsed = new Date(request.start_time);
  return {
    ...request,
    ...(Number.isNaN(parsed.getTime())
      ? {}
      : { start_time: parsed.toISOString().replace(".000Z", "Z") }),
    ...(request.video_url !== undefined && {
      video_url: normalizeWebsiteURL(request.video_url),
    }),
    ...(request.location !== undefined && {
      location: request.location.trim(),
    }),
    interviewer_emails: request.interviewer_emails.map(normalizeEmailAddress),
  };
}

/**
 * A video interview names a link and no location; an in-person interview a
 * location and no link. That the start is in the future is the API's rule.
 */
function validateInterviewDetails(details: InterviewDetails): string[] {
  const fields: string[] = [];
  if (Number.isNaN(new Date(details.start_time).getTime())) {
    fields.push("start_time");
  }
  if (!isInterviewDurationMinutes(details.duration_minutes)) {
    fields.push("duration_minutes");
  }
  if (!isInterviewMode(details.mode)) {
    fields.push("mode");
  } else {
    const video = details.mode === "video";
    if (
      (details.video_url !== undefined && !isWebsiteURL(details.video_url)) ||
      (video && details.video_url === undefined) ||
      (!video && details.video_url !== undefined)
    ) {
      fields.push("video_url");
    }
    if (
      (details.location !== undefined &&
        !isInterviewLocation(details.location)) ||
      (!video && details.location === undefined) ||
      (video && details.location !== undefined)
    ) {
      fields.push("location");
    }
  }
  const emails = details.interviewer_emails;
  if (emails.length < 1 || emails.length > maxInterviewers) {
    fields.push("interviewer_emails");
  } else if (
    emails.some((email) => !isEmailAddress(email)) ||
    new Set(emails).size !== emails.length
  ) {
    fields.push("interviewer_emails");
  }
  return fields;
}

export interface ScheduleInterviewRequest
  extends ApplicationActionRequest,
    InterviewDetails {}

export function normalizeScheduleInterviewRequest(
  request: ScheduleInterviewRequest,
): ScheduleInterviewRequest {
  return normalizeInterviewDetails(request);
}

export function validateScheduleInterviewRequest(
  request: ScheduleInterviewRequest,
): string[] {
  const normalized = normalizeScheduleInterviewRequest(request);
  return [
    ...validateApplicationActionRequest(normalized),
    ...validateInterviewDetails(normalized),
  ];
}

export interface ChangeInterviewRequest
  extends ApplicationActionRequest,
    InterviewDetails {
  interview_number: InterviewNumber;
}

export function normalizeChangeInterviewRequest(
  request: ChangeInterviewRequest,
): ChangeInterviewRequest {
  return normalizeInterviewDetails(request);
}

export function validateChangeInterviewRequest(
  request: ChangeInterviewRequest,
): string[] {
  const normalized = normalizeChangeInterviewRequest(request);
  const fields = validateApplicationActionRequest(normalized);
  if (!isInterviewNumber(normalized.interview_number)) {
    fields.push("interview_number");
  }
  return [...fields, ...validateInterviewDetails(normalized)];
}

export interface CancelInterviewRequest extends ApplicationActionRequest {
  interview_number: InterviewNumber;
}

export function validateCancelInterviewRequest(
  request: CancelInterviewRequest,
): string[] {
  const fields = validateApplicationActionRequest(request);
  if (!isInterviewNumber(request.interview_number)) {
    fields.push("interview_number");
  }
  return fields;
}

export interface RecordInterviewOutcomeRequest extends CancelInterviewRequest {
  outcome: InterviewOutcome;
}

export function validateRecordInterviewOutcomeRequest(
  request: RecordInterviewOutcomeRequest,
): string[] {
  const fields = validateCancelInterviewRequest(request);
  if (!isInterviewOutcome(request.outcome)) fields.push("outcome");
  return fields;
}

export interface SubmitInterviewFeedbackRequest extends CancelInterviewRequest {
  recommendation: InterviewRecommendation;
  notes: InterviewFeedbackNotes;
}

export function normalizeSubmitInterviewFeedbackRequest(
  request: SubmitInterviewFeedbackRequest,
): SubmitInterviewFeedbackRequest {
  return { ...request, notes: request.notes.trim() };
}

export function validateSubmitInterviewFeedbackRequest(
  request: SubmitInterviewFeedbackRequest,
): string[] {
  const normalized = normalizeSubmitInterviewFeedbackRequest(request);
  const fields = validateCancelInterviewRequest(normalized);
  if (!isInterviewRecommendation(normalized.recommendation)) {
    fields.push("recommendation");
  }
  if (!isInterviewFeedbackNotes(normalized.notes)) fields.push("notes");
  return fields;
}

export interface ListMyInterviewsRequest {
  pagination_key?: PaginationKey;
  limit?: PageSize;
}

export function effectiveListMyInterviewsLimit(
  request: ListMyInterviewsRequest,
): PageSize {
  return request.limit ?? 50;
}

export function validateListMyInterviewsRequest(
  request: ListMyInterviewsRequest,
): string[] {
  const fields: string[] = [];
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  ) {
    fields.push("pagination_key");
  }
  if (request.limit !== undefined && !isPageSize(request.limit)) {
    fields.push("limit");
  }
  return fields;
}

export interface MyInterview {
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
  display_name: DisplayName;
  interview_number: InterviewNumber;
  starts_at: string;
  duration_minutes: InterviewDurationMinutes;
  mode: InterviewMode;
  state: InterviewState;
  applicant_response: InterviewResponse;
  feedback_submitted: boolean;
}

export interface ListMyInterviewsResponse {
  interviews: MyInterview[];
  next_pagination_key?: PaginationKey;
}

export interface RecordAssessmentResultRequest
  extends ApplicationActionRequest {
  outcome: AssessmentOutcome;
  score?: AssessmentScore;
  notes?: ResultNotes;
  report_url?: WebsiteURL;
}

function normalizedResultDetails<
  T extends { notes?: ResultNotes; report_url?: WebsiteURL },
>(request: T): T {
  const { notes, report_url: link, ...rest } = request;
  const trimmed = notes?.trim();
  return {
    ...rest,
    ...(trimmed ? { notes: trimmed } : {}),
    ...(link === undefined ? {} : { report_url: normalizeWebsiteURL(link) }),
  } as T;
}

function validateResultDetails(request: {
  notes?: ResultNotes;
  report_url?: WebsiteURL;
}): string[] {
  const fields: string[] = [];
  if (request.notes !== undefined && !isResultNotes(request.notes)) {
    fields.push("notes");
  }
  if (request.report_url !== undefined && !isWebsiteURL(request.report_url)) {
    fields.push("report_url");
  }
  return fields;
}

/** Trims the notes, dropping blank ones, and normalizes the link, leaving the
 * caller's value. */
export function normalizeRecordAssessmentResultRequest(
  request: RecordAssessmentResultRequest,
): RecordAssessmentResultRequest {
  return normalizedResultDetails(request);
}

export function validateRecordAssessmentResultRequest(
  request: RecordAssessmentResultRequest,
): string[] {
  const normalized = normalizeRecordAssessmentResultRequest(request);
  const fields = validateApplicationActionRequest(normalized);
  if (!isAssessmentOutcome(normalized.outcome)) fields.push("outcome");
  if (normalized.score !== undefined && !isAssessmentScore(normalized.score)) {
    fields.push("score");
  }
  return fields.concat(validateResultDetails(normalized));
}

export interface RequestBackgroundCheckConsentRequest
  extends ApplicationActionRequest {
  check_types: CheckType[];
}

export function validateRequestBackgroundCheckConsentRequest(
  request: RequestBackgroundCheckConsentRequest,
): string[] {
  const fields = validateApplicationActionRequest(request);
  const types = request.check_types;
  if (
    !Array.isArray(types) ||
    types.length < 1 ||
    types.length > maxCheckTypes ||
    !types.every(isCheckType) ||
    new Set(types).size !== types.length
  ) {
    fields.push("check_types");
  }
  return fields;
}

export interface RecordBackgroundCheckResultRequest
  extends ApplicationActionRequest {
  check_type: CheckType;
  outcome: CheckOutcome;
  notes?: ResultNotes;
  report_url?: WebsiteURL;
}

/** Trims the notes, dropping blank ones, and normalizes the link, leaving the
 * caller's value. */
export function normalizeRecordBackgroundCheckResultRequest(
  request: RecordBackgroundCheckResultRequest,
): RecordBackgroundCheckResultRequest {
  return normalizedResultDetails(request);
}

export function validateRecordBackgroundCheckResultRequest(
  request: RecordBackgroundCheckResultRequest,
): string[] {
  const normalized = normalizeRecordBackgroundCheckResultRequest(request);
  const fields = validateApplicationActionRequest(normalized);
  if (!isCheckType(normalized.check_type)) fields.push("check_type");
  if (!isCheckOutcome(normalized.outcome)) fields.push("outcome");
  return fields.concat(validateResultDetails(normalized));
}
