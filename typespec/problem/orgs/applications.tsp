import "../details.tsp";

namespace Vetchium.Problem;

const OrgApplicationNotFoundError = #{
  type: "vetchium-problem-details/org-application-not-found",
  title: "Org application not found",
  status: 404,
  detail: "No readable application has the requested number",
};
alias OrgApplicationNotFoundErrorResponse = Response<
  404,
  typeof OrgApplicationNotFoundError
>;
