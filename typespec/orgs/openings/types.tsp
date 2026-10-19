import "../../common/common.tsp";
import "../../common/openings.tsp";
import "../../common/pagination.tsp";

namespace Vetchium.Orgs.Openings;

@minValue(1)
scalar OpeningNumber extends int32;

@minValue(1)
scalar OpeningVersion extends int32;

enum OpeningState {
  Draft: "draft",
  Discarded: "discarded",
  Published: "published",
  Paused: "paused",
  Closed: "closed",
  Expired: "expired",
}

enum OpeningRequestKind {
  Publish: "publish",
  Revise: "revise",
  Pause: "pause",
  Reopen: "reopen",
  Close: "close",
}

enum OpeningRequestState {
  Pending: "pending",
  Approved: "approved",
  Rejected: "rejected",
  Withdrawn: "withdrawn",
  Superseded: "superseded",
  Cancelled: "cancelled",
}

enum OpeningDecision {
  Approve: "approve",
  Reject: "reject",
}

enum OpeningHistoryAction {
  Created: "created",
  Duplicated: "duplicated",
  WorkingCopySaved: "working_copy_saved",
  TeamChanged: "team_changed",
  PipelineChanged: "pipeline_changed",
  RevisionDiscarded: "revision_discarded",
  Discarded: "discarded",
  Requested: "requested",
  Approved: "approved",
  SelfApproved: "self_approved",
  Rejected: "rejected",
  Withdrawn: "withdrawn",
  Superseded: "superseded",
  Cancelled: "cancelled",
  Expired: "expired",
}

model OpeningTeamUser {
  email: Vetchium.EmailAddress;
  active: boolean;
}

model PendingOpeningRequest {
  kind: OpeningRequestKind;
  requested_by_email: Vetchium.EmailAddress;
  requested_at: utcDateTime;
  note?: string;

  /** A `close` request only: applying it marks every open application. */
  mark_applications_not_progressing?: boolean;
}

model OrgOpening {
  opening_number: OpeningNumber;
  state: OpeningState;
  version: OpeningVersion;
  revision: int32;
  live_content?: Vetchium.OpeningContent;
  working_content?: Vetchium.OpeningContent;
  pending_request?: PendingOpeningRequest;
  hiring_manager?: OpeningTeamUser;
  recruiter?: OpeningTeamUser;
  team_members: OpeningTeamUser[];
  internal_notes?: string;
  created_by_email: Vetchium.EmailAddress;
  created_at: utcDateTime;
  updated_at: utcDateTime;
  first_published_at?: utcDateTime;
  expires_at?: utcDateTime;
  last_revised_at?: utcDateTime;
  ended_at?: utcDateTime;
}

model OrgOpeningSummary {
  opening_number: OpeningNumber;
  state: OpeningState;
  title?: string;
  employing_country?: Vetchium.CountryCode;
  work_arrangement?: Vetchium.OpeningWorkArrangement;
  employment_type?: Vetchium.OpeningEmploymentType;
  hiring_manager_email?: Vetchium.EmailAddress;
  recruiter_email?: Vetchium.EmailAddress;
  pending_request_kind?: OpeningRequestKind;
  updated_at: utcDateTime;
  expires_at?: utcDateTime;
}

model OpeningStateCount {
  state: OpeningState;
  count: int32;
}

model OpeningQuotaUsage {
  limit: int32;
  used: int32;
  window_start: utcDateTime;
}

model OpeningHistoryEntry {
  action: OpeningHistoryAction;
  actor_email?: Vetchium.EmailAddress;
  request_kind?: OpeningRequestKind;
  request_state?: OpeningRequestState;
  request_note?: string;
  decision_note?: string;
  source_opening_number?: OpeningNumber;
  version: OpeningVersion;
  created_at: utcDateTime;
}
