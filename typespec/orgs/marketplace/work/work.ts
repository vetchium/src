import type { DisplayName } from "../../../common/localization.ts";
import type { PaginationKey } from "../../../common/pagination.ts";
import { isPaginationKey } from "../../../common/pagination.ts";
import type { TenantID } from "../../../directory/directory.ts";
import type { WebsiteURL } from "../../../hub/profile/public.ts";
import type { ApplicantSnapshot } from "../../../hub/profile/snapshot.ts";
import type {
  ApplicationCoverNote,
  AssessmentOutcome,
  AssessmentResult,
  AssessmentScore,
  BackgroundCheck,
  CheckOutcome,
  Interview,
  InterviewDetails,
  InterviewFeedbackNotes,
  InterviewNumber,
  InterviewOutcome,
  InterviewRecommendation,
  ResultNotes,
} from "../../applications/applications.ts";
import {
  isInterviewNumber,
  normalizeChangeInterviewRequest as orgNormalizeChangeInterviewRequest,
  normalizeRecordAssessmentResultRequest as orgNormalizeRecordAssessmentResultRequest,
  normalizeRecordBackgroundCheckResultRequest as orgNormalizeRecordBackgroundCheckResultRequest,
  normalizeScheduleInterviewRequest as orgNormalizeScheduleInterviewRequest,
  normalizeSubmitInterviewFeedbackRequest as orgNormalizeSubmitInterviewFeedbackRequest,
  validateChangeInterviewRequest as orgValidateChangeInterviewRequest,
  validateRecordAssessmentResultRequest as orgValidateRecordAssessmentResultRequest,
  validateRecordBackgroundCheckResultRequest as orgValidateRecordBackgroundCheckResultRequest,
  validateScheduleInterviewRequest as orgValidateScheduleInterviewRequest,
  validateSubmitInterviewFeedbackRequest as orgValidateSubmitInterviewFeedbackRequest,
} from "../../applications/applications.ts";
import type { CheckType } from "../../hiring/vocabulary.ts";
import type { OpeningNumber, OpeningState } from "../../openings/types.ts";
import { openingStates } from "../../openings/types.ts";

function isOpeningState(value: unknown): value is OpeningState {
  return openingStates.includes(value as OpeningState);
}

import type { OrgDomain } from "../../types.ts";
import { isOrgDomain, normalizeOrgDomain } from "../../types.ts";
import type { Capability } from "../capabilities.ts";
import { isCapability } from "../capabilities.ts";
import type { EngagementCounterparty, EngagementID } from "../engagements.ts";
import { isEngagementID } from "../engagements.ts";

/** Bounds one page of the work queue or the jobs. */
export const maxPage = 50;

export type WorkID = string;

export const workStatusValues = [
  "pending",
  "scheduled",
  "awaiting_consent",
  "in_progress",
  "completed",
] as const;
export type WorkStatus = (typeof workStatusValues)[number];

const workStatuses = new Set<string>(workStatusValues);

export function isWorkStatus(value: unknown): value is WorkStatus {
  return typeof value === "string" && workStatuses.has(value);
}

const workIDPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Accepts the lowercase form the API returns. */
export function isWorkID(value: string): boolean {
  return workIDPattern.test(value);
}

/** An Opening as its provider names it. */
export interface WorkOpening {
  number: OpeningNumber;
  title: string;
  employing_country?: string;
}

/** One routed candidacy in a list. */
export interface WorkItem {
  work_id: WorkID;
  engagement_id: EngagementID;
  /** The consumer. */
  client: EngagementCounterparty;
  capability: Capability;
  opening: WorkOpening;
  stage_name: string;
  status: WorkStatus;
  applicant_name: DisplayName;
  next_interview_at?: string;
  routed_at: string;
}

/** A routed candidacy and what its provider may see. */
export interface WorkDetail {
  item: WorkItem;
  snapshot: ApplicantSnapshot;
  cover_note?: ApplicationCoverNote;
  interviews: Interview[];
  assessment?: AssessmentResult;
  background_check?: BackgroundCheck;
}

/** Names a routed candidacy by its engagement and work id. */
export interface WorkReference {
  engagement_id: EngagementID;
  work_id: WorkID;
}

export function validateWorkReference(request: WorkReference): string[] {
  const fields: string[] = [];
  if (!isEngagementID(request.engagement_id)) fields.push("engagement_id");
  if (!isWorkID(request.work_id)) fields.push("work_id");
  return fields;
}

function validStageName(value: string): boolean {
  const length = Array.from(value).length;
  return (
    length >= 1 &&
    length <= 100 &&
    value === value.trim() &&
    !value.includes("\u0000")
  );
}

export interface ListWorkQueueRequest {
  client_domain?: OrgDomain;
  capability?: Capability;
  /** With `client_domain` only: Opening numbers are per client. */
  opening_number?: OpeningNumber;
  stage_name?: string;
  status?: WorkStatus;
  pagination_key?: PaginationKey;
  /** Defaults to 50. */
  limit?: number;
}

export function normalizeListWorkQueueRequest(
  request: ListWorkQueueRequest,
): ListWorkQueueRequest {
  const normalized = { ...request };
  if (request.client_domain !== undefined)
    normalized.client_domain = normalizeOrgDomain(request.client_domain);
  if (request.stage_name !== undefined)
    normalized.stage_name = request.stage_name.trim();
  return normalized;
}

export function validateListWorkQueueRequest(
  request: ListWorkQueueRequest,
): string[] {
  const fields: string[] = [];
  if (
    request.client_domain !== undefined &&
    !isOrgDomain(request.client_domain)
  )
    fields.push("client_domain");
  if (request.capability !== undefined && !isCapability(request.capability))
    fields.push("capability");
  if (
    request.opening_number !== undefined &&
    (!Number.isInteger(request.opening_number) ||
      request.opening_number < 1 ||
      request.client_domain === undefined)
  )
    fields.push("opening_number");
  if (request.stage_name !== undefined && !validStageName(request.stage_name))
    fields.push("stage_name");
  if (request.status !== undefined && !isWorkStatus(request.status))
    fields.push("status");
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  )
    fields.push("pagination_key");
  if (
    request.limit !== undefined &&
    (!Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > maxPage)
  )
    fields.push("limit");
  return fields;
}

export interface ListWorkQueueResponse {
  items: WorkItem[];
  /** Tenants that did not answer, so the queue is incomplete. */
  unavailable_tenants: TenantID[];
  next_pagination_key?: PaginationKey;
}

/** An Opening assigned to a `sourcing` engagement. */
export interface Job {
  engagement_id: EngagementID;
  client: EngagementCounterparty;
  opening: WorkOpening;
  state: OpeningState;
  assigned_at: string;
}

/** The Opening's live content. */
export interface JobDetail {
  job: Job;
  content: Record<string, unknown>;
}

export interface JobReference {
  engagement_id: EngagementID;
  opening_number: OpeningNumber;
}

export function validateJobReference(request: JobReference): string[] {
  const fields: string[] = [];
  if (!isEngagementID(request.engagement_id)) fields.push("engagement_id");
  if (!Number.isInteger(request.opening_number) || request.opening_number < 1)
    fields.push("opening_number");
  return fields;
}

export interface ListJobsRequest {
  client_domain?: OrgDomain;
  /** Defaults to `published`. */
  state?: OpeningState;
  pagination_key?: PaginationKey;
  /** Defaults to 50. */
  limit?: number;
}

export function normalizeListJobsRequest(
  request: ListJobsRequest,
): ListJobsRequest {
  const normalized = { ...request };
  if (request.client_domain !== undefined)
    normalized.client_domain = normalizeOrgDomain(request.client_domain);
  return normalized;
}

export function validateListJobsRequest(request: ListJobsRequest): string[] {
  const fields: string[] = [];
  if (
    request.client_domain !== undefined &&
    !isOrgDomain(request.client_domain)
  )
    fields.push("client_domain");
  if (request.state !== undefined && !isOpeningState(request.state))
    fields.push("state");
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  )
    fields.push("pagination_key");
  if (
    request.limit !== undefined &&
    (!Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > maxPage)
  )
    fields.push("limit");
  return fields;
}

export interface ListJobsResponse {
  jobs: Job[];
  unavailable_tenants: TenantID[];
  next_pagination_key?: PaginationKey;
}

/** The work a write names and its status afterwards. */
export interface WriteResult {
  work_id: WorkID;
  status: WorkStatus;
  interview_number?: InterviewNumber;
}

export interface InterviewReference extends WorkReference {
  interview_number: InterviewNumber;
}

export function validateInterviewReference(
  request: InterviewReference,
): string[] {
  const fields = validateWorkReference(request);
  if (!isInterviewNumber(request.interview_number))
    fields.push("interview_number");
  return fields;
}

// The writes share their fields with the Org's own, so they borrow those
// validators under a reference that always passes.
const reference = { opening_number: 1, application_number: 1, version: 1 };

/** The request with the normalized values of the fields it carries, and none
 * of the borrowed reference's. */
function normalizedLike<T extends object>(request: T, normalized: object): T {
  const result = { ...request } as Record<string, unknown>;
  for (const key of Object.keys(request)) {
    result[key] = (normalized as Record<string, unknown>)[key];
  }
  return result as T;
}

function onlyOwnFields(fields: string[]): string[] {
  return fields.filter(
    (field) =>
      !["opening_number", "application_number", "version"].includes(field),
  );
}

export interface ScheduleInterviewRequest
  extends WorkReference,
    InterviewDetails {}

export function normalizeScheduleInterviewRequest(
  request: ScheduleInterviewRequest,
): ScheduleInterviewRequest {
  return normalizedLike(
    request,
    orgNormalizeScheduleInterviewRequest({ ...reference, ...request }),
  );
}

export function validateScheduleInterviewRequest(
  request: ScheduleInterviewRequest,
): string[] {
  return [
    ...validateWorkReference(request),
    ...onlyOwnFields(
      orgValidateScheduleInterviewRequest({ ...reference, ...request }),
    ),
  ];
}

export interface ChangeInterviewRequest
  extends InterviewReference,
    InterviewDetails {}

export function normalizeChangeInterviewRequest(
  request: ChangeInterviewRequest,
): ChangeInterviewRequest {
  return normalizedLike(
    request,
    orgNormalizeChangeInterviewRequest({ ...reference, ...request }),
  );
}

export function validateChangeInterviewRequest(
  request: ChangeInterviewRequest,
): string[] {
  return [
    ...validateWorkReference(request),
    ...onlyOwnFields(
      orgValidateChangeInterviewRequest({ ...reference, ...request }),
    ),
  ];
}

export interface RecordInterviewOutcomeRequest extends InterviewReference {
  outcome: InterviewOutcome;
}

export function validateRecordInterviewOutcomeRequest(
  request: RecordInterviewOutcomeRequest,
): string[] {
  const fields = validateInterviewReference(request);
  if (request.outcome !== "completed" && request.outcome !== "no_show")
    fields.push("outcome");
  return fields;
}

export interface SubmitInterviewFeedbackRequest extends InterviewReference {
  recommendation: InterviewRecommendation;
  notes: InterviewFeedbackNotes;
}

export function normalizeSubmitInterviewFeedbackRequest(
  request: SubmitInterviewFeedbackRequest,
): SubmitInterviewFeedbackRequest {
  return normalizedLike(
    request,
    orgNormalizeSubmitInterviewFeedbackRequest({ ...reference, ...request }),
  );
}

export function validateSubmitInterviewFeedbackRequest(
  request: SubmitInterviewFeedbackRequest,
): string[] {
  return [
    ...validateWorkReference(request),
    ...onlyOwnFields(
      orgValidateSubmitInterviewFeedbackRequest({ ...reference, ...request }),
    ),
  ];
}

export interface RecordAssessmentRequest extends WorkReference {
  outcome: AssessmentOutcome;
  score?: AssessmentScore;
  notes?: ResultNotes;
  report_url?: WebsiteURL;
}

export function normalizeRecordAssessmentRequest(
  request: RecordAssessmentRequest,
): RecordAssessmentRequest {
  return normalizedLike(
    request,
    orgNormalizeRecordAssessmentResultRequest({ ...reference, ...request }),
  );
}

export function validateRecordAssessmentRequest(
  request: RecordAssessmentRequest,
): string[] {
  return [
    ...validateWorkReference(request),
    ...onlyOwnFields(
      orgValidateRecordAssessmentResultRequest({ ...reference, ...request }),
    ),
  ];
}

export interface RecordBackgroundCheckResultRequest extends WorkReference {
  check_type: CheckType;
  outcome: CheckOutcome;
  notes?: ResultNotes;
  report_url?: WebsiteURL;
}

export function normalizeRecordBackgroundCheckResultRequest(
  request: RecordBackgroundCheckResultRequest,
): RecordBackgroundCheckResultRequest {
  return normalizedLike(
    request,
    orgNormalizeRecordBackgroundCheckResultRequest({
      ...reference,
      ...request,
    }),
  );
}

export function validateRecordBackgroundCheckResultRequest(
  request: RecordBackgroundCheckResultRequest,
): string[] {
  return [
    ...validateWorkReference(request),
    ...onlyOwnFields(
      orgValidateRecordBackgroundCheckResultRequest({
        ...reference,
        ...request,
      }),
    ),
  ];
}
