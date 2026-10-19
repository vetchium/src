import type { EmailAddress } from "../../common/common.ts";
import type { CountryCode } from "../../common/localization.ts";
import type {
  OpeningContent,
  OpeningEmploymentType,
  OpeningWorkArrangement,
} from "../../common/openings.ts";

export type OpeningNumber = number;
export type OpeningVersion = number;

export const openingStates = [
  "draft",
  "discarded",
  "published",
  "paused",
  "closed",
  "expired",
] as const;
export type OpeningState = (typeof openingStates)[number];

export const openingRequestKinds = [
  "publish",
  "revise",
  "pause",
  "reopen",
  "close",
] as const;
export type OpeningRequestKind = (typeof openingRequestKinds)[number];

export const openingRequestStates = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
  "superseded",
  "cancelled",
] as const;
export type OpeningRequestState = (typeof openingRequestStates)[number];

export const openingDecisions = ["approve", "reject"] as const;
export type OpeningDecision = (typeof openingDecisions)[number];

export const openingHistoryActions = [
  "created",
  "duplicated",
  "working_copy_saved",
  "team_changed",
  "pipeline_changed",
  "revision_discarded",
  "discarded",
  "requested",
  "approved",
  "self_approved",
  "rejected",
  "withdrawn",
  "superseded",
  "cancelled",
  "expired",
] as const;
export type OpeningHistoryAction = (typeof openingHistoryActions)[number];

export interface OpeningTeamUser {
  email: EmailAddress;
  active: boolean;
}

export interface PendingOpeningRequest {
  kind: OpeningRequestKind;
  requested_by_email: EmailAddress;
  requested_at: string;
  note?: string;
  mark_applications_not_progressing?: boolean;
}

export interface OrgOpening {
  opening_number: OpeningNumber;
  state: OpeningState;
  version: OpeningVersion;
  revision: number;
  live_content?: OpeningContent;
  working_content?: OpeningContent;
  pending_request?: PendingOpeningRequest;
  hiring_manager?: OpeningTeamUser;
  recruiter?: OpeningTeamUser;
  team_members: OpeningTeamUser[];
  internal_notes?: string;
  created_by_email: EmailAddress;
  created_at: string;
  updated_at: string;
  first_published_at?: string;
  expires_at?: string;
  last_revised_at?: string;
  ended_at?: string;
}

export interface OrgOpeningSummary {
  opening_number: OpeningNumber;
  state: OpeningState;
  title?: string;
  employing_country?: CountryCode;
  work_arrangement?: OpeningWorkArrangement;
  employment_type?: OpeningEmploymentType;
  hiring_manager_email?: EmailAddress;
  recruiter_email?: EmailAddress;
  pending_request_kind?: OpeningRequestKind;
  updated_at: string;
  expires_at?: string;
}

export interface OpeningStateCount {
  state: OpeningState;
  count: number;
}

export interface OpeningQuotaUsage {
  limit: number;
  used: number;
  window_start: string;
}

export interface OpeningHistoryEntry {
  action: OpeningHistoryAction;
  actor_email?: EmailAddress;
  request_kind?: OpeningRequestKind;
  request_state?: OpeningRequestState;
  request_note?: string;
  decision_note?: string;
  source_opening_number?: OpeningNumber;
  version: OpeningVersion;
  created_at: string;
}
