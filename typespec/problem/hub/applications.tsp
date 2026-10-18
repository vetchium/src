import "../details.tsp";

namespace Vetchium.Problem;

const HubApplicationExistsError = #{
  type: "vetchium-problem-details/hub-application-exists",
  title: "Application exists",
  status: 409,
  detail: "The applicant already applied to this Opening",
};
alias HubApplicationExistsErrorResponse = Response<
  409,
  typeof HubApplicationExistsError
>;

const HubOpeningNotAcceptingError = #{
  type: "vetchium-problem-details/hub-opening-not-accepting",
  title: "Opening not accepting applications",
  status: 409,
  detail: "The Opening is not accepting applications",
};
alias HubOpeningNotAcceptingErrorResponse = Response<
  409,
  typeof HubOpeningNotAcceptingError
>;
