import "../details.tsp";

namespace Vetchium.Problem;

const HubOperationNotFoundError = #{
  type: "vetchium-problem-details/hub-operation-not-found",
  title: "Hub operation not found",
  status: 404,
  detail: "The requested operation was not found",
};
alias HubOperationNotFoundErrorResponse = Response<
  404,
  typeof HubOperationNotFoundError
>;
