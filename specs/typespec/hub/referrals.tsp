import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

union ReferralState {
  Pending:         "pending",
  AcceptedApplied: "accepted_applied",
  Declined:        "declined",
  Expired:         "expired",
}

model NominateColleagueRequest {
  candidate_handle: Handle;
  org_domain:       string;
  opening_number:   int32;
  statement_text:   string;     // 100..2000
}

model NominateColleagueResponse { nomination_id: string; }

model ReferralReceived {
  nomination_id:         string;
  referrer_handle:       Handle;
  referrer_display_name: string;
  org_domain:            string;
  org_name:              string;
  opening_number:        int32;
  opening_title:         string;
  shared_domain:         string;
  overlap_start_year:    int32;
  overlap_end_year:      int32;
  statement_text:        string;
  state:                 ReferralState;
  created_at:            utcDateTime;
  expires_at:            utcDateTime;
}

model ReferralMade {
  nomination_id:          string;
  candidate_handle:       Handle;
  candidate_display_name: string;
  org_domain:             string;
  opening_number:         int32;
  opening_title:          string;
  state:                  ReferralState;
  candidate_did_apply:    boolean;
  created_at:             utcDateTime;
}

model ListReferralsRequest { pagination_key?: string; limit?: int32; }
model ListReferralsReceivedResponse { referrals: ReferralReceived[]; next_pagination_key?: string; }
model ListReferralsMadeResponse     { referrals: ReferralMade[];     next_pagination_key?: string; }

model AcceptReferralRequest  { nomination_id: string; }
model AcceptReferralResponse {
  org_domain:                         string;
  opening_number:                     int32;
  prefill_statement_for_endorsement:  string;
}

model DeclineReferralRequest { nomination_id: string; }

@route("/hub/nominate-colleague-for-role")
@post op nominateColleague(...NominateColleagueRequest):
  CreatedResponse<NominateColleagueResponse>
  | BadRequestResponse
  | { @statusCode statusCode: 403 }
  | NotFoundResponse
  | ConflictResponse
  | UnprocessableEntityResponse;

@route("/hub/list-referrals-received")
@post op listReferralsReceived(...ListReferralsRequest):
  OkResponse<ListReferralsReceivedResponse>;

@route("/hub/list-referrals-made")
@post op listReferralsMade(...ListReferralsRequest):
  OkResponse<ListReferralsMadeResponse>;

@route("/hub/accept-referral")
@post op acceptReferral(...AcceptReferralRequest):
  OkResponse<AcceptReferralResponse> | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/decline-referral")
@post op declineReferral(...DeclineReferralRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
