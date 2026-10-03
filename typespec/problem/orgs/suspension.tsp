import "../details.tsp";

namespace Vetchium.Problem;

const OrgSuspendedError = #{
  type: "vetchium-problem-details/org-suspended",
  title: "Org suspended",
  status: 403,
  detail: "The Org is suspended and may only use billing and account operations",
};
alias OrgSuspendedErrorResponse = Response<403, typeof OrgSuspendedError>;
