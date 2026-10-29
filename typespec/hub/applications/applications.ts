import type { DisplayName } from "../../common/localization.ts";
import {
  isPaginationKey,
  type PaginationKey,
} from "../../common/pagination.ts";
import {
  type AnsweredQuestion,
  type ApplicationAnswer,
  normalizeAnswers,
  validateAnswerShapes,
} from "../../orgs/applications/answers.ts";
import {
  type ApplicationCoverNote,
  type ApplicationNumber,
  type BackgroundCheckNumber,
  type CalendarDate,
  type InterviewDurationMinutes,
  type InterviewLocation,
  type InterviewMode,
  type InterviewNumber,
  type InterviewRescheduleNote,
  type InterviewResponse,
  isApplicationCoverNote,
  isApplicationNumber,
  isBackgroundCheckNumber,
  isInterviewNumber,
  isInterviewRescheduleNote,
  isOfferNumber,
  type OfferNumber,
  type OfferStatus,
  type WorkPerformer,
} from "../../orgs/applications/applications.ts";
import type { CheckType } from "../../orgs/hiring/vocabulary.ts";
import type { EngagementCounterparty } from "../../orgs/marketplace/engagements.ts";
import type { OpeningNumber } from "../../orgs/openings/types.ts";
import {
  isOrgDomain,
  normalizeOrgDomain,
  type OrgDomain,
} from "../../orgs/types.ts";

export const applicationStatusValues = [
  "applied",
  "in_review",
  "interviewing",
  "offer",
  "hired",
  "not_progressing",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof applicationStatusValues)[number];

export const pendingActionKindValues = [
  "interview_response",
  "background_check_consent",
  "offer_response",
] as const;

export type PendingActionKind = (typeof pendingActionKindValues)[number];

export type MyApplicationPageSize = number;

export function isApplicationStatus(
  value: unknown,
): value is ApplicationStatus {
  return (applicationStatusValues as readonly unknown[]).includes(value);
}

export function isPendingActionKind(
  value: unknown,
): value is PendingActionKind {
  return (pendingActionKindValues as readonly unknown[]).includes(value);
}

export interface ApplyToOpeningRequest {
  domain: OrgDomain;
  opening_number: OpeningNumber;
  cover_note?: ApplicationCoverNote;
  referral_agency_domain?: OrgDomain;
  answers?: ApplicationAnswer[];
}

export interface ApplicationReference {
  domain: OrgDomain;
  opening_number: OpeningNumber;
  application_number: ApplicationNumber;
}

export type WithdrawApplicationRequest = ApplicationReference;
export type GetMyApplicationRequest = ApplicationReference;

export interface MyApplication {
  org_domain: OrgDomain;
  org_display_name: DisplayName;
  opening_number: OpeningNumber;
  opening_title: string;
  application_number: ApplicationNumber;
  status: ApplicationStatus;
  pending_actions: PendingActionKind[];
}

/** The latest offer unless the Org withdrew it. */
export interface MyApplicationOffer {
  offer_number: OfferNumber;
  status: OfferStatus;
  letter_url: string;
  letter_byte_size: number;
  proposed_joining_date?: CalendarDate;
  respond_by: string;
  extended_at: string;
}

export const myInterviewStateValues = ["scheduled", "cancelled"] as const;
export type MyInterviewState = (typeof myInterviewStateValues)[number];

const myInterviewStates = new Set<string>(myInterviewStateValues);

export function isMyInterviewState(value: unknown): value is MyInterviewState {
  return typeof value === "string" && myInterviewStates.has(value);
}

/** An interview without its stage name or interviewers. */
export interface MyApplicationInterview {
  interview_number: InterviewNumber;
  state: MyInterviewState;
  starts_at: string;
  duration_minutes: InterviewDurationMinutes;
  mode: InterviewMode;
  video_url?: string;
  location?: InterviewLocation;
  response: InterviewResponse;
  reschedule_note?: InterviewRescheduleNote;
  /** The provider holding the interview for the Org; absent when in-house. */
  provider?: EngagementCounterparty;
}

/** The consent request awaiting the applicant. */
export interface MyBackgroundCheckConsent {
  check_number: BackgroundCheckNumber;
  check_types: CheckType[];
  performer: WorkPerformer;
  /** The provider performing the checks, with the text it asks the applicant to consent to. */
  provider?: EngagementCounterparty;
  disclosure?: string;
  requested_at: string;
}

export interface MyApplicationDetail extends MyApplication {
  offer?: MyApplicationOffer;
  background_check_consent?: MyBackgroundCheckConsent;
  interviews: MyApplicationInterview[];
  /** The questions as asked when applying, with the applicant's answers. */
  answers: AnsweredQuestion[];
}

export interface InterviewReference extends ApplicationReference {
  interview_number: InterviewNumber;
}

export type AcceptInterviewRequest = InterviewReference;

export interface RequestInterviewRescheduleRequest extends InterviewReference {
  note: InterviewRescheduleNote;
}

export function normalizeRequestInterviewRescheduleRequest(
  request: RequestInterviewRescheduleRequest,
): RequestInterviewRescheduleRequest {
  return {
    ...normalizeApplicationReference(request),
    interview_number: request.interview_number,
    note: request.note.trim(),
  };
}

export function validateAcceptInterviewRequest(
  request: AcceptInterviewRequest,
): string[] {
  const fields = validateApplicationReference(request);
  if (!isInterviewNumber(request.interview_number)) {
    fields.push("interview_number");
  }
  return fields;
}

export function validateRequestInterviewRescheduleRequest(
  request: RequestInterviewRescheduleRequest,
): string[] {
  const normalized = normalizeRequestInterviewRescheduleRequest(request);
  const fields = validateAcceptInterviewRequest(normalized);
  if (!isInterviewRescheduleNote(normalized.note)) fields.push("note");
  return fields;
}

export interface BackgroundCheckConsentRequest extends ApplicationReference {
  check_number: BackgroundCheckNumber;
}

export function validateBackgroundCheckConsentRequest(
  request: BackgroundCheckConsentRequest,
): string[] {
  const fields = validateApplicationReference(request);
  if (!isBackgroundCheckNumber(request.check_number)) {
    fields.push("check_number");
  }
  return fields;
}

export interface RespondToOfferRequest extends ApplicationReference {
  offer_number: OfferNumber;
}

export function validateRespondToOfferRequest(
  request: RespondToOfferRequest,
): string[] {
  const fields = validateApplicationReference(request);
  if (!isOfferNumber(request.offer_number)) fields.push("offer_number");
  return fields;
}

export interface MyApplicationSummary extends MyApplication {
  applied_at: string;
  last_activity_at: string;
}

export interface ListMyApplicationsRequest {
  pagination_key?: PaginationKey;
  limit?: MyApplicationPageSize;
}

export interface ListMyApplicationsResponse {
  applications: MyApplicationSummary[];
  next_pagination_key?: PaginationKey;
}

/** Lower-cases the domain, trims the cover note, and drops a blank one,
 * leaving the caller's value. */
export function normalizeApplyToOpeningRequest(
  request: ApplyToOpeningRequest,
): ApplyToOpeningRequest {
  const {
    cover_note: note,
    referral_agency_domain: referral,
    answers,
    ...rest
  } = request;
  const domain = normalizeOrgDomain(rest.domain);
  const trimmed = note?.trim();
  const normalizedReferral = referral
    ? normalizeOrgDomain(referral)
    : undefined;
  return {
    ...rest,
    domain,
    ...(trimmed ? { cover_note: trimmed } : {}),
    ...(normalizedReferral
      ? { referral_agency_domain: normalizedReferral }
      : {}),
    ...(answers ? { answers: normalizeAnswers(answers) } : {}),
  };
}

export function validateApplyToOpeningRequest(
  request: ApplyToOpeningRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDomain(request.domain)) fields.push("domain");
  if (!Number.isInteger(request.opening_number) || request.opening_number < 1) {
    fields.push("opening_number");
  }
  if (
    request.referral_agency_domain !== undefined &&
    !isOrgDomain(request.referral_agency_domain)
  ) {
    fields.push("referral_agency_domain");
  }
  if (
    request.cover_note !== undefined &&
    !isApplicationCoverNote(request.cover_note)
  ) {
    fields.push("cover_note");
  }
  return [...fields, ...validateAnswerShapes(request.answers ?? [])];
}

export function normalizeApplicationReference(
  reference: ApplicationReference,
): ApplicationReference {
  return { ...reference, domain: normalizeOrgDomain(reference.domain) };
}

export function validateApplicationReference(
  reference: ApplicationReference,
): string[] {
  const fields: string[] = [];
  if (!isOrgDomain(reference.domain)) fields.push("domain");
  if (
    !Number.isInteger(reference.opening_number) ||
    reference.opening_number < 1
  ) {
    fields.push("opening_number");
  }
  if (!isApplicationNumber(reference.application_number)) {
    fields.push("application_number");
  }
  return fields;
}

export function effectiveListMyApplicationsLimit(
  request: ListMyApplicationsRequest,
): number {
  return request.limit ?? 50;
}

export function validateListMyApplicationsRequest(
  request: ListMyApplicationsRequest,
): string[] {
  const fields: string[] = [];
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  ) {
    fields.push("pagination_key");
  }
  const limit = effectiveListMyApplicationsLimit(request);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    fields.push("limit");
  }
  return fields;
}
