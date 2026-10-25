import type { EmailAddress } from "../../../common/common.ts";
import {
  isEmailAddress,
  normalizeEmailAddress,
} from "../../../common/common.ts";
import { isCountryCode } from "../../../common/countries.ts";
import type { DisplayName } from "../../../common/localization.ts";
import type { PaginationKey } from "../../../common/pagination.ts";
import { isPaginationKey } from "../../../common/pagination.ts";
import type { TenantID } from "../../../directory/directory.ts";
import type { ApplicationStatus } from "../../../hub/applications/applications.ts";
import type { WebsiteURL } from "../../../hub/profile/public.ts";
import type { ApplicantSnapshot } from "../../../hub/profile/snapshot.ts";
import type { HubHandle } from "../../../hub/types.ts";
import type {
  ApplicationCoverNote,
  ApplicationNumber,
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
import type { ReferralRoute } from "../attribution.ts";
import type { ContactID } from "../contacts/contacts.ts";

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

export type WorkPageSize = number;

export function isWorkPageSize(value: unknown): value is WorkPageSize {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= maxPage
  );
}

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

/**
 * Trimmed text of 1 to 100 code points without NUL, the shape of stage names
 * and of every search and suggestion query here.
 */
function validText(value: string): boolean {
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
  if (request.stage_name !== undefined && !validText(request.stage_name))
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

/**
 * Counts the changes to a Job's owner; 0 before the Job first had one. It
 * keeps rising when the owner is cleared, so a stale write never matches.
 */
export type JobOwnerVersion = number;

/**
 * Bounds the Jobs of active engagements one agency user owns, which also
 * bounds the owner filter a list sends to client tenants.
 */
export const maxJobsPerOwner = 200;

/**
 * An Opening assigned to a `sourcing` engagement. `credited_count` counts the
 * applications credited to the agency, not to one of its users.
 */
export interface Job {
  engagement_id: EngagementID;
  client: EngagementCounterparty;
  opening: WorkOpening;
  state: OpeningState;
  credited_count: number;
  assigned_at: string;
  /**
   * The agency user who looks after the Job. The agency's own tenant keeps
   * it and sets it with `owner_version`; a client's tenant never sends
   * either.
   */
  owner?: EmailAddress;
  owner_version?: JobOwnerVersion;
}

export interface JobCreditedApplication {
  application_number: ApplicationNumber;
  route: ReferralRoute;
  status: ApplicationStatus;
  applied_at: string;
}

export interface JobSuggestedContact {
  contact_id: ContactID;
  display_name: DisplayName;
  handle: HubHandle;
  suggested_at: string;
}

/** The Opening's live content. */
export interface JobDetail {
  job: Job;
  content: Record<string, unknown>;
  credited_applications: JobCreditedApplication[];
  suggested_contacts: JobSuggestedContact[];
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

/** A title substring or an Opening number, trimmed. */
export type JobSearchText = string;

export function isJobSearchText(value: string): value is JobSearchText {
  return validText(value);
}

export interface ListJobsRequest {
  client_domain?: OrgDomain;
  /** Defaults to `published`. */
  state?: OpeningState;
  /**
   * Only the Jobs this agency user owns. An address that owns none, or is
   * not the agency's, lists nothing.
   */
  owner_email?: EmailAddress;
  /** Matches the title case-insensitively, or the Opening number exactly. */
  search?: JobSearchText;
  employing_country?: string;
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
  if (request.owner_email !== undefined)
    normalized.owner_email = normalizeEmailAddress(request.owner_email);
  if (request.search !== undefined) normalized.search = request.search.trim();
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
  if (request.owner_email !== undefined && !isEmailAddress(request.owner_email))
    fields.push("owner_email");
  if (request.search !== undefined && !isJobSearchText(request.search))
    fields.push("search");
  if (
    request.employing_country !== undefined &&
    !isCountryCode(request.employing_country)
  )
    fields.push("employing_country");
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

/**
 * Sets or clears the one agency user who looks after a Job. Any user with
 * `org:fulfil_engagements` may set any colleague who also holds it.
 */
export interface SetJobOwnerRequest {
  engagement_id: EngagementID;
  opening_number: OpeningNumber;
  /** The `owner_version` the caller read; 0 when the Job never had an owner. */
  owner_version: JobOwnerVersion;
  /** Absent clears the owner. */
  owner_email?: EmailAddress;
}

export function normalizeSetJobOwnerRequest(
  request: SetJobOwnerRequest,
): SetJobOwnerRequest {
  const normalized = { ...request };
  if (request.owner_email !== undefined)
    normalized.owner_email = normalizeEmailAddress(request.owner_email);
  return normalized;
}

export function validateSetJobOwnerRequest(
  request: SetJobOwnerRequest,
): string[] {
  const fields = validateJobReference(request);
  if (!Number.isInteger(request.owner_version) || request.owner_version < 0)
    fields.push("owner_version");
  if (request.owner_email !== undefined && !isEmailAddress(request.owner_email))
    fields.push("owner_email");
  return fields;
}

export interface JobOwnership {
  owner?: EmailAddress;
  owner_version: JobOwnerVersion;
}

/** Bounds one autocomplete answer. */
export const maxSuggestions = 20;

/** Text an autocomplete matches, trimmed. */
export type SuggestionQuery = string;

export function isSuggestionQuery(value: string): value is SuggestionQuery {
  return validText(value);
}

function validateSuggestion(query?: string, limit?: number): string[] {
  const fields: string[] = [];
  if (query !== undefined && !isSuggestionQuery(query)) fields.push("query");
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > maxSuggestions)
  )
    fields.push("limit");
  return fields;
}

/**
 * Suggests the agency's users who may own a Job: active, holding
 * `org:fulfil_engagements`, whose address contains `query`. It answers at
 * most `limit` in address order and has no further pages.
 */
export interface SuggestJobOwnersRequest {
  query?: SuggestionQuery;
  /** Defaults to 20. */
  limit?: number;
}

export function normalizeSuggestJobOwnersRequest(
  request: SuggestJobOwnersRequest,
): SuggestJobOwnersRequest {
  const normalized = { ...request };
  if (request.query !== undefined) normalized.query = request.query.trim();
  return normalized;
}

export function validateSuggestJobOwnersRequest(
  request: SuggestJobOwnersRequest,
): string[] {
  return validateSuggestion(request.query, request.limit);
}

export interface SuggestJobOwnersResponse {
  owners: EmailAddress[];
}

/**
 * Suggests the consumers of the Org's active engagements as provider, of
 * `capability` when given, whose display name or domain contains `query`.
 * It answers at most `limit`, ordered by display name then domain, and has
 * no further pages.
 */
export interface SuggestClientsRequest {
  capability?: Capability;
  query?: SuggestionQuery;
  /** Defaults to 20. */
  limit?: number;
}

export function normalizeSuggestClientsRequest(
  request: SuggestClientsRequest,
): SuggestClientsRequest {
  const normalized = { ...request };
  if (request.query !== undefined) normalized.query = request.query.trim();
  return normalized;
}

export function validateSuggestClientsRequest(
  request: SuggestClientsRequest,
): string[] {
  const fields: string[] = [];
  if (request.capability !== undefined && !isCapability(request.capability))
    fields.push("capability");
  return [...fields, ...validateSuggestion(request.query, request.limit)];
}

export interface SuggestClientsResponse {
  clients: EngagementCounterparty[];
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
