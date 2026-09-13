import "../details.tsp";
import "../../hub/subscriptions/plans.tsp";

namespace Vetchium.Problem;

const HubPlanNotOfferedError = #{
  type: "vetchium-problem-details/hub-plan-not-offered",
  title: "Hub plan not offered",
  status: 403,
  detail: "This tenant does not offer that Hub plan",
};
alias HubPlanNotOfferedErrorResponse = Response<
  403,
  typeof HubPlanNotOfferedError
>;

model HubPlanRequiredDetails {
  type: "vetchium-problem-details/hub-plan-required";
  title: "Hub plan required";
  status: 403;
  detail: "This operation requires a higher Hub plan";
  required_plan_oid: Vetchium.Hub.HubPlanOID;
  instance?: string;
}

alias HubPlanRequiredErrorResponse = Response<403, HubPlanRequiredDetails>;
