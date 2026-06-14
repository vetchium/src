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

// ---- Agency: openings I'm assigned to ----

model ListAssignedOpeningsRequest {
  filter_client_domain?: string;
  filter_recruiter?:     string;
  pagination_key?:       string;
  limit?:                int32;
}

model AssignedOpening {
  opening_id:             string;
  consumer_org_domain:    string;
  opening_number:         int32;
  title:                  string;
  assigned_at:            utcDateTime;
  recruiters:             AgencyRecruiterRef[];
  recruiters_are_default: boolean;
  referral_counts:        ReferralStateCounts;
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

// ---- Agency: internal recruiter assignment + client defaults ----

model AssignOpeningRecruitersRequest {
  opening_id:          string;
  consumer_org_domain: string;
  agency_org_user_ids: string[];
}

model RemoveOpeningRecruiterRequest {
  opening_id:         string;
  agency_org_user_id: string;
}

model ListAgencyRecruitersResponse { recruiters: AgencyRecruiterRef[]; }

model ClientDefaultRecruiter {
  consumer_org_domain: string;
  recruiters:          AgencyRecruiterRef[];
}

model ListClientDefaultRecruitersResponse { defaults: ClientDefaultRecruiter[]; }

model SetClientDefaultRecruitersRequest {
  consumer_org_domain: string;
  agency_org_user_ids: string[];
}

model RemoveClientDefaultRecruiterRequest {
  consumer_org_domain: string;
  agency_org_user_id:  string;
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

@route("/org/assign-opening-recruiters")
@post op assignOpeningRecruiters(...AssignOpeningRecruitersRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse;

@route("/org/remove-opening-recruiter")
@post op removeOpeningRecruiter(...RemoveOpeningRecruiterRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse;

@route("/org/list-client-default-recruiters")
@post op listClientDefaultRecruiters():
  OkResponse<ListClientDefaultRecruitersResponse>;

@route("/org/set-client-default-recruiters")
@post op setClientDefaultRecruiters(...SetClientDefaultRecruitersRequest):
  OkResponse<{}> | BadRequestResponse;

@route("/org/remove-client-default-recruiter")
@post op removeClientDefaultRecruiter(...RemoveClientDefaultRecruiterRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse;
