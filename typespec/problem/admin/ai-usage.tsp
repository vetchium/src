import "../details.tsp";

namespace Vetchium.Problem;

const AdminOrgNotFoundError = #{
  type: "vetchium-problem-details/admin-org-not-found",
  title: "Org not found",
  status: 404,
  detail: "No Org of this tenant holds that domain",
};
alias AdminOrgNotFoundErrorResponse = Response<
  404,
  typeof AdminOrgNotFoundError
>;

const AdminAIUsageNotFoundError = #{
  type: "vetchium-problem-details/admin-ai-usage-not-found",
  title: "AI usage not found",
  status: 404,
  detail: "The Org has no kept AI usage text with that identifier",
};
alias AdminAIUsageNotFoundErrorResponse = Response<
  404,
  typeof AdminAIUsageNotFoundError
>;
