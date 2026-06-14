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

model ListAssignedOpeningsRequest { pagination_key?: string; limit?: int32; }

model AssignedOpening {
  opening_id:          string;
  consumer_org_domain: string;
  opening_number:      int32;
  title:               string;
  assigned_at:         utcDateTime;
}

model ListAssignedOpeningsResponse {
  openings: AssignedOpening[];
  next_pagination_key?: string;
}

// ---- Agency: refer a candidate ----

model ReferCandidateRequest {
  opening_id:       string;
  candidate_handle: Handle;
  statement_text?:  string;
}

model ReferCandidateResponse { referral_id: string; }

// ---- Agency: referrals my agency has made ----

model ListAgencyReferralsRequest { pagination_key?: string; limit?: int32; }

model AgencyReferral {
  referral_id:         string;
  candidate_handle:    Handle;
  consumer_org_domain: string;
  opening_number:      int32;
  opening_title:       string;
  state:               AgencyReferralState;
  created_at:          utcDateTime;
}

model ListAgencyReferralsResponse {
  referrals: AgencyReferral[];
  next_pagination_key?: string;
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
