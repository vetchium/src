import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "../org/agency-referrals.tsp";

using TypeSpec.Http;
namespace Vetchium;

// AgencyReferralState is defined in org/agency-referrals.tsp.

model ListReferralsReceivedRequest {
  pagination_key?: string;
  limit?: int32;
}

model ReferralReceived {
  referral_id:         string;
  agency_org_domain:   string;
  agency_org_name:     string;
  consumer_org_domain: string;
  opening_number:      int32;
  opening_title:       string;
  statement_text?:     string;
  state:               AgencyReferralState;
  created_at:          utcDateTime;
  expires_at:          utcDateTime;
}

model ListReferralsReceivedResponse {
  referrals: ReferralReceived[];
  next_pagination_key?: string;
}

model DeclineReferralRequest { referral_id: string; }

// Count of pending agency referrals awaiting the candidate's action (apply or
// decline). Used to surface an actionable badge on the hub dashboard tile.
model PendingReferralsCountResponse { count: int32; }

@route("/hub/list-referrals-received")
@post op listReferralsReceived(...ListReferralsReceivedRequest):
  OkResponse<ListReferralsReceivedResponse> | BadRequestResponse;

@route("/hub/decline-referral")
@post op declineReferral(...DeclineReferralRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/pending-referrals-count")
@get op pendingReferralsCount(): OkResponse<PendingReferralsCountResponse>;
