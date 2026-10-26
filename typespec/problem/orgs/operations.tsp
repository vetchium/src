import "../details.tsp";

namespace Vetchium.Problem;

const OrgOperationNotFoundError = #{
  type: "vetchium-problem-details/org-operation-not-found",
  title: "Org operation not found",
  status: 404,
  detail: "The requested operation was not found",
};
alias OrgOperationNotFoundErrorResponse = Response<
  404,
  typeof OrgOperationNotFoundError
>;
