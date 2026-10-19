import type { EmailAddress } from "../../common/common.ts";
import type { CountryCode, DisplayName } from "../../common/localization.ts";
import type { PageSize, PaginationKey } from "../../common/pagination.ts";
import { isPageSize, isPaginationKey } from "../../common/pagination.ts";
import type { ApplicantSnapshot } from "../../hub/profile/snapshot.ts";
import type { PipelineStage, PipelineStageID } from "../hiring/pipelines.ts";
import { isPipelineStageID } from "../hiring/pipelines.ts";
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
