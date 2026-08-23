import "../details.tsp";

namespace Vetchium.Problem;

const HubSignupDomainNotFoundError = #{
  type: "vetchium-problem-details/hub-signup-domain-not-found",
  title: "Hub signup domain not found",
  status: 404,
  detail: "The requested Hub signup domain does not exist",
};

alias HubSignupDomainNotFoundErrorResponse = Response<
  404,
  typeof HubSignupDomainNotFoundError
>;

const HubSignupDomainAlreadyExistsError = #{
  type: "vetchium-problem-details/hub-signup-domain-already-exists",
  title: "Hub signup domain already exists",
  status: 409,
  detail: "The normalized domain is already in the Hub signup allowlist",
};

alias HubSignupDomainAlreadyExistsErrorResponse = Response<
  409,
  typeof HubSignupDomainAlreadyExistsError
>;
