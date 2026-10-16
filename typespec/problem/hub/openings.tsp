import "../details.tsp";

namespace Vetchium.Problem;

const HubOrgNotFoundError = #{
  type: "vetchium-problem-details/hub-org-not-found",
  title: "Org not found",
  status: 404,
  detail: "The requested Org was not found",
};
alias HubOrgNotFoundErrorResponse = Response<404, typeof HubOrgNotFoundError>;

const HubOpeningNotFoundError = #{
  type: "vetchium-problem-details/hub-opening-not-found",
  title: "Opening not found",
  status: 404,
  detail: "The requested Opening was not found",
};
alias HubOpeningNotFoundErrorResponse = Response<
  404,
  typeof HubOpeningNotFoundError
>;

const HubOrgUnavailableError = #{
  type: "vetchium-problem-details/hub-org-unavailable",
  title: "Org unavailable",
  status: 503,
  detail: "The requested Org is temporarily unavailable",
};
alias HubOrgUnavailableErrorResponse = Response<
  503,
  typeof HubOrgUnavailableError
>;
