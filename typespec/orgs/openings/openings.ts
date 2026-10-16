import type { EmailAddress } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";
import { isCountryCode } from "../../common/countries.ts";
import type { CountryCode } from "../../common/localization.ts";
import type {
  OpeningContent,
  OpeningEmploymentType,
  OpeningWorkArrangement,
} from "../../common/openings.ts";
import {
  normalizeOpeningContent,
  validateOpeningContent,
} from "../../common/openings.ts";
import type { PageSize, PaginationKey } from "../../common/pagination.ts";
import { isPageSize, isPaginationKey } from "../../common/pagination.ts";
import type {
  OpeningDecision,
  OpeningHistoryEntry,
  OpeningNumber,
  OpeningQuotaUsage,
  OpeningRequestKind,
  OpeningState,
  OpeningStateCount,
  OpeningTeamUser,
  OpeningVersion,
  OrgOpeningSummary,
} from "./types.ts";
import { openingRequestKinds, openingStates } from "./types.ts";

export interface CreateOpeningRequest {
  content: OpeningContent;
  hiring_manager_email?: EmailAddress;
  recruiter_email?: EmailAddress;
  team_member_emails: EmailAddress[];
  internal_notes?: string;
}

export interface DuplicateOpeningRequest {
  opening_number: OpeningNumber;
}
export interface GetOpeningRequest {
  opening_number: OpeningNumber;
}

export interface ListOpeningsRequest {
  states?: OpeningState[];
  pending_request_kinds?: OpeningRequestKind[];
  awaiting_my_approval?: boolean;
  hiring_manager_email?: EmailAddress;
  recruiter_email?: EmailAddress;
  employing_country?: CountryCode;
  work_arrangement?: OpeningWorkArrangement;
  employment_type?: OpeningEmploymentType;
  title_query?: string;
  pagination_key?: PaginationKey;
  limit?: PageSize;
}

export interface ListOpeningsResponse {
  openings: OrgOpeningSummary[];
  next_pagination_key?: PaginationKey;
}

export type OpeningSummaryRequest = Record<string, never>;
export interface OpeningSummaryResponse {
  counts: OpeningStateCount[];
  quota: OpeningQuotaUsage;
}

export interface LookupOpeningTeamMemberRequest {
  email_address: EmailAddress;
}

export interface LookupOpeningTeamMemberResponse {
  member?: OpeningTeamUser;
}

export function normalizeLookupOpeningTeamMemberRequest(
  request: LookupOpeningTeamMemberRequest,
): LookupOpeningTeamMemberRequest {
  return { email_address: normalizeEmailAddress(request.email_address) };
}

export function validateLookupOpeningTeamMemberRequest(
  request: LookupOpeningTeamMemberRequest,
): string[] {
  return isEmailAddress(normalizeEmailAddress(request.email_address))
    ? []
    : ["email_address"];
}

export interface SaveOpeningWorkingCopyRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
  content: OpeningContent;
}

export interface DiscardOpeningWorkingCopyRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
}

export interface SetOpeningTeamRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
  hiring_manager_email?: EmailAddress;
  recruiter_email?: EmailAddress;
  team_member_emails: EmailAddress[];
  internal_notes?: string;
}

export interface DiscardOpeningRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
}

export interface RequestOpeningChangeRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
  kind: OpeningRequestKind;
  note?: string;
}

export interface DecideOpeningRequestRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
  decision: OpeningDecision;
  note?: string;
}

export interface WithdrawOpeningRequestRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
}

export interface ListOpeningHistoryRequest {
  opening_number: OpeningNumber;
  pagination_key?: PaginationKey;
  limit?: PageSize;
}

export interface ListOpeningHistoryResponse {
  entries: OpeningHistoryEntry[];
  next_pagination_key?: PaginationKey;
}

function normalizeTeam<
  T extends {
    hiring_manager_email?: EmailAddress;
    recruiter_email?: EmailAddress;
    team_member_emails: EmailAddress[];
    internal_notes?: string;
  },
>(request: T): T {
  return {
    ...request,
    ...(request.hiring_manager_email !== undefined && {
      hiring_manager_email: normalizeEmailAddress(request.hiring_manager_email),
    }),
    ...(request.recruiter_email !== undefined && {
      recruiter_email: normalizeEmailAddress(request.recruiter_email),
    }),
    team_member_emails: request.team_member_emails.map(normalizeEmailAddress),
    ...(request.internal_notes !== undefined && {
      internal_notes: request.internal_notes.trim(),
    }),
  };
}

function validateTeam(request: {
  hiring_manager_email?: EmailAddress;
  recruiter_email?: EmailAddress;
  team_member_emails: EmailAddress[];
  internal_notes?: string;
}): string[] {
  const fields: string[] = [];
  if (
    request.hiring_manager_email !== undefined &&
    !isEmailAddress(request.hiring_manager_email)
  )
    fields.push("hiring_manager_email");
  if (
    request.recruiter_email !== undefined &&
    !isEmailAddress(request.recruiter_email)
  )
    fields.push("recruiter_email");
  if (
    !Array.isArray(request.team_member_emails) ||
    request.team_member_emails.length > 20 ||
    new Set(request.team_member_emails).size !==
      request.team_member_emails.length ||
    !request.team_member_emails.every(isEmailAddress)
  )
    fields.push("team_member_emails");
  if (
    request.internal_notes !== undefined &&
    ([...request.internal_notes].length < 1 ||
      [...request.internal_notes].length > 2000)
  )
    fields.push("internal_notes");
  return fields;
}

export function normalizeCreateOpeningRequest(
  request: CreateOpeningRequest,
): CreateOpeningRequest {
  return {
    ...normalizeTeam(request),
    content: normalizeOpeningContent(request.content),
  };
}
export function validateCreateOpeningRequest(
  request: CreateOpeningRequest,
): string[] {
  const normalized = normalizeCreateOpeningRequest(request);
  return [
    ...validateOpeningContent(normalized.content).map(
      (field) => `content.${field}`,
    ),
    ...validateTeam(normalized),
  ];
}

function validNumber(number: number): boolean {
  return Number.isInteger(number) && number >= 1 && number <= 2147483647;
}
function validVersion(version: number): boolean {
  return validNumber(version);
}
function validateNumberVersion(number: number, version: number): string[] {
  const fields: string[] = [];
  if (!validNumber(number)) fields.push("opening_number");
  if (!validVersion(version)) fields.push("version");
  return fields;
}

export function validateDuplicateOpeningRequest(
  request: DuplicateOpeningRequest,
): string[] {
  return validNumber(request.opening_number) ? [] : ["opening_number"];
}
export function validateGetOpeningRequest(
  request: GetOpeningRequest,
): string[] {
  return validNumber(request.opening_number) ? [] : ["opening_number"];
}

export function normalizeListOpeningsRequest(
  request: ListOpeningsRequest,
): ListOpeningsRequest {
  return {
    ...request,
    ...(request.hiring_manager_email !== undefined && {
      hiring_manager_email: normalizeEmailAddress(request.hiring_manager_email),
    }),
    ...(request.recruiter_email !== undefined && {
      recruiter_email: normalizeEmailAddress(request.recruiter_email),
    }),
    ...(request.employing_country !== undefined && {
      employing_country: request.employing_country.trim().toUpperCase(),
    }),
    ...(request.title_query !== undefined && {
      title_query: request.title_query.trim(),
    }),
  };
}

export function validateListOpeningsRequest(
  request: ListOpeningsRequest,
): string[] {
  const r = normalizeListOpeningsRequest(request);
  const fields: string[] = [];
  if (
    r.states !== undefined &&
    (r.states.length < 1 ||
      r.states.length > 6 ||
      new Set(r.states).size !== r.states.length ||
      !r.states.every((state) => openingStates.includes(state)))
  )
    fields.push("states");
  if (
    r.pending_request_kinds !== undefined &&
    (r.pending_request_kinds.length < 1 ||
      r.pending_request_kinds.length > 5 ||
      new Set(r.pending_request_kinds).size !==
        r.pending_request_kinds.length ||
      !r.pending_request_kinds.every((kind) =>
        openingRequestKinds.includes(kind),
      ))
  )
    fields.push("pending_request_kinds");
  if (
    r.hiring_manager_email !== undefined &&
    !isEmailAddress(r.hiring_manager_email)
  )
    fields.push("hiring_manager_email");
  if (r.recruiter_email !== undefined && !isEmailAddress(r.recruiter_email))
    fields.push("recruiter_email");
  if (r.employing_country !== undefined && !isCountryCode(r.employing_country))
    fields.push("employing_country");
  if (
    r.work_arrangement !== undefined &&
    !["on_site", "hybrid", "remote"].includes(r.work_arrangement)
  )
    fields.push("work_arrangement");
  if (
    r.employment_type !== undefined &&
    !["full_time", "part_time", "contract", "internship"].includes(
      r.employment_type,
    )
  )
    fields.push("employment_type");
  if (
    r.title_query !== undefined &&
    ([...r.title_query].length < 2 || [...r.title_query].length > 200)
  )
    fields.push("title_query");
  if (r.pagination_key !== undefined && !isPaginationKey(r.pagination_key))
    fields.push("pagination_key");
  if (r.limit !== undefined && !isPageSize(r.limit)) fields.push("limit");
  return fields;
}

export function normalizeSaveOpeningWorkingCopyRequest(
  request: SaveOpeningWorkingCopyRequest,
): SaveOpeningWorkingCopyRequest {
  return { ...request, content: normalizeOpeningContent(request.content) };
}
export function validateSaveOpeningWorkingCopyRequest(
  request: SaveOpeningWorkingCopyRequest,
): string[] {
  return [
    ...validateNumberVersion(request.opening_number, request.version),
    ...validateOpeningContent(normalizeOpeningContent(request.content)).map(
      (field) => `content.${field}`,
    ),
  ];
}

export function validateDiscardOpeningWorkingCopyRequest(
  request: DiscardOpeningWorkingCopyRequest,
): string[] {
  return validateNumberVersion(request.opening_number, request.version);
}

export function normalizeSetOpeningTeamRequest(
  request: SetOpeningTeamRequest,
): SetOpeningTeamRequest {
  return normalizeTeam(request);
}
export function validateSetOpeningTeamRequest(
  request: SetOpeningTeamRequest,
): string[] {
  const r = normalizeSetOpeningTeamRequest(request);
  return [
    ...validateNumberVersion(r.opening_number, r.version),
    ...validateTeam(r),
  ];
}

export function validateDiscardOpeningRequest(
  request: DiscardOpeningRequest,
): string[] {
  return validateNumberVersion(request.opening_number, request.version);
}

function validNote(note: string | undefined): boolean {
  return (
    note === undefined || ([...note].length >= 1 && [...note].length <= 2000)
  );
}

export function normalizeRequestOpeningChangeRequest(
  request: RequestOpeningChangeRequest,
): RequestOpeningChangeRequest {
  return {
    ...request,
    ...(request.note !== undefined && { note: request.note.trim() }),
  };
}
export function validateRequestOpeningChangeRequest(
  request: RequestOpeningChangeRequest,
): string[] {
  const r = normalizeRequestOpeningChangeRequest(request);
  const fields = validateNumberVersion(r.opening_number, r.version);
  if (!openingRequestKinds.includes(r.kind)) fields.push("kind");
  if (!validNote(r.note)) fields.push("note");
  return fields;
}

export function normalizeDecideOpeningRequestRequest(
  request: DecideOpeningRequestRequest,
): DecideOpeningRequestRequest {
  return {
    ...request,
    ...(request.note !== undefined && { note: request.note.trim() }),
  };
}
export function validateDecideOpeningRequestRequest(
  request: DecideOpeningRequestRequest,
): string[] {
  const r = normalizeDecideOpeningRequestRequest(request);
  const fields = validateNumberVersion(r.opening_number, r.version);
  if (r.decision !== "approve" && r.decision !== "reject")
    fields.push("decision");
  if (!validNote(r.note) || (r.decision === "reject" && r.note === undefined))
    fields.push("note");
  return fields;
}

export function validateWithdrawOpeningRequestRequest(
  request: WithdrawOpeningRequestRequest,
): string[] {
  return validateNumberVersion(request.opening_number, request.version);
}

export function validateListOpeningHistoryRequest(
  request: ListOpeningHistoryRequest,
): string[] {
  const fields: string[] = [];
  if (!validNumber(request.opening_number)) fields.push("opening_number");
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  )
    fields.push("pagination_key");
  if (request.limit !== undefined && !isPageSize(request.limit))
    fields.push("limit");
  return fields;
}
