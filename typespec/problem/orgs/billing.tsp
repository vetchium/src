import "../details.tsp";
import "../../orgs/subscriptions/plans.tsp";

namespace Vetchium.Problem;

const OrgPlanNotOfferedError = #{
  type: "vetchium-problem-details/org-plan-not-offered",
  title: "Org plan not offered",
  status: 403,
  detail: "This tenant does not offer that Org plan",
};
alias OrgPlanNotOfferedErrorResponse = Response<
  403,
  typeof OrgPlanNotOfferedError
>;

model OrgPlanRequiredDetails {
  type: "vetchium-problem-details/org-plan-required";
  title: "Org plan required";
  status: 403;
  detail: "This operation requires a higher Org plan";
  plan_oid: Vetchium.Orgs.OrgPlanOID;
  instance?: string;
}
alias OrgPlanRequiredErrorResponse = Response<403, OrgPlanRequiredDetails>;





model OrgUserLimitExceedsTargetDetails {
  type: "vetchium-problem-details/org-user-limit-exceeds-target";
  title: "Org users exceed the target limit";
  status: 409;
  detail: "The Org has more users than the requested configuration allows. Remove users or cancel invitations first.";

  /** The seat cap the request would put in force. */
  limit: int32;

  /** Active users plus unexpired invitations now. */
  seats_in_use: int32;

  instance?: string;
}
alias OrgUserLimitExceedsTargetErrorResponse = Response<
  409,
  OrgUserLimitExceedsTargetDetails
>;
