import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

union ApplicationMode {
  Open:       "open",
  AgencyOnly: "agency_only",
}

union AgencyReferralState {
  Pending:         "pending",
  AcceptedApplied: "accepted_applied",
  Declined:        "declined",
  Expired:         "expired",
  NotSelected:     "not_selected",
}

model AgencyRecruiterRef {
  org_user_id: string;
  name:        string;
  email:       string;
}

model ReferralStateCounts {
  pending:          int32;
  accepted_applied: int32;
  declined:         int32;
  expired:          int32;
  not_selected:     int32;
}

// ---- Consumer: assign / list / remove agencies on an opening ----

model AssignOpeningAgencyRequest {
  opening_id:        string;
  agency_org_domain: string;
}

model RemoveOpeningAgencyRequest {
  opening_id:        string;
  agency_org_domain: string;
}

model ListOpeningAgenciesRequest { opening_id: string; }

model OpeningAgency {
  agency_org_domain: string;
  agency_org_name:   string;
  assigned_at:       utcDateTime;
  referrals_made:    int32;
}

model ListOpeningAgenciesResponse { agencies: OpeningAgency[]; }

// Consumer's active staffing-subscription providers, eligible to be assigned as
// recruiting agencies on an opening (used to populate the assign-agency picker).
model AssignableAgency {
  agency_org_domain: string;
  agency_org_name:   string;
}

model ListAssignableAgenciesResponse { agencies: AssignableAgency[]; }

// ---- Agency: clients I have an active staffing subscription with ----

// A consumer org that has an active staffing subscription with the caller's
// agency. Available for client-default configuration even before any opening is
// assigned.
model StaffingClient {
  consumer_org_domain: string;
  consumer_org_name:   string;
}

model ListStaffingClientsResponse { clients: StaffingClient[]; }

// ---- Agency: openings I'm assigned to ----

model ListAssignedOpeningsRequest {
  filter_client_domain?: string;
  // "" (all) | "me" | "needs_reassignment" | an agency org_user_id
  filter_assignee?:      string;
  pagination_key?:       string;
  limit?:                int32;
}

model AssignedOpening {
  opening_id:          string;
  consumer_org_domain: string;
  opening_number:      int32;
  title:               string;
  assigned_at:         utcDateTime;
  // The single agency recruiter who owns this opening. Absent when the opening
  // has no assignee yet (degenerate case: the agency had no eligible assignee at
  // assign time).
  assignee?:           AgencyRecruiterRef;
  // True when the opening has no assignee, or its assignee is no longer an active
  // agency user — i.e. a lead must (re)assign it.
  needs_reassignment:  boolean;
  referral_counts:     ReferralStateCounts;
}

model ListAssignedOpeningsResponse {
  openings: AssignedOpening[];
  next_pagination_key?: string;
}

model GetAssignedOpeningRequest { opening_id: string; }
model GetAssignedOpeningResponse { opening: AssignedOpening; }

// ---- Agency: refer a candidate ----

model ReferCandidateRequest {
  opening_id:       string;
  candidate_handle: Handle;
  statement_text?:  string;
}

model ReferCandidateResponse { referral_id: string; }

// ---- Agency: referrals my agency has made ----

model ListAgencyReferralsRequest {
  filter_opening_id?: string;
  pagination_key?:    string;
  limit?:             int32;
}

model AgencyReferral {
  referral_id:         string;
  candidate_handle:    Handle;
  consumer_org_domain: string;
  opening_id:          string;
  opening_number:      int32;
  opening_title:       string;
  statement_text?:     string;
  state:               AgencyReferralState;
  referred_by_name:    string;
  created_at:          utcDateTime;
  expires_at:          utcDateTime;
}

model ListAgencyReferralsResponse {
  referrals: AgencyReferral[];
  next_pagination_key?: string;
}

// ---- Agency: single-assignee management + per-client default assignee ----

model ListAgencyRecruitersResponse { recruiters: AgencyRecruiterRef[]; }

// Reassign an opening's single owner to another active agency user.
model ReassignOpeningRequest {
  opening_id:         string;
  agency_org_user_id: string;
}

// The single default assignee an agency has configured for one client domain.
model ClientDefaultAssignee {
  consumer_org_domain: string;
  assignee:            AgencyRecruiterRef;
}

model ListClientDefaultAssigneesResponse { defaults: ClientDefaultAssignee[]; }

model SetClientDefaultAssigneeRequest {
  consumer_org_domain: string;
  agency_org_user_id:  string;
}

model ClearClientDefaultAssigneeRequest {
  consumer_org_domain: string;
}

// Dashboard summary: how many of the agency's openings need (re)assignment.
model AgencyReferralSummaryResponse {
  needs_reassignment_count: int32;
}

@route("/org/assign-opening-agency")
@post op assignOpeningAgency(...AssignOpeningAgencyRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;

@route("/org/remove-opening-agency")
@post op removeOpeningAgency(...RemoveOpeningAgencyRequest):
  OkResponse<{}> | NotFoundResponse;

@route("/org/list-opening-agencies")
@post op listOpeningAgencies(...ListOpeningAgenciesRequest):
  OkResponse<ListOpeningAgenciesResponse> | BadRequestResponse;

@route("/org/list-assignable-agencies")
@post op listAssignableAgencies():
  OkResponse<ListAssignableAgenciesResponse>;

@route("/org/list-staffing-clients")
@post op listStaffingClients():
  OkResponse<ListStaffingClientsResponse>;

@route("/org/list-assigned-openings")
@post op listAssignedOpenings(...ListAssignedOpeningsRequest):
  OkResponse<ListAssignedOpeningsResponse> | BadRequestResponse;

@route("/org/refer-candidate")
@post op referCandidate(...ReferCandidateRequest):
  CreatedResponse<ReferCandidateResponse>
  | BadRequestResponse
  | { @statusCode statusCode: 403 }
  | NotFoundResponse
  | ConflictResponse
  | UnprocessableEntityResponse;

@route("/org/list-agency-referrals")
@post op listAgencyReferrals(...ListAgencyReferralsRequest):
  OkResponse<ListAgencyReferralsResponse> | BadRequestResponse;

@route("/org/get-assigned-opening")
@post op getAssignedOpening(...GetAssignedOpeningRequest):
  OkResponse<GetAssignedOpeningResponse> | BadRequestResponse
  | { @statusCode statusCode: 403 } | NotFoundResponse;

@route("/org/list-agency-recruiters")
@post op listAgencyRecruiters():
  OkResponse<ListAgencyRecruitersResponse>;

@route("/org/reassign-opening")
@post op reassignOpening(...ReassignOpeningRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;

@route("/org/list-client-default-assignees")
@post op listClientDefaultAssignees():
  OkResponse<ListClientDefaultAssigneesResponse>;

@route("/org/set-client-default-assignee")
@post op setClientDefaultAssignee(...SetClientDefaultAssigneeRequest):
  OkResponse<{}> | BadRequestResponse | UnprocessableEntityResponse;

@route("/org/clear-client-default-assignee")
@post op clearClientDefaultAssignee(...ClearClientDefaultAssigneeRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse;

@route("/org/get-agency-referral-summary")
@post op getAgencyReferralSummary():
  OkResponse<AgencyReferralSummaryResponse>;
