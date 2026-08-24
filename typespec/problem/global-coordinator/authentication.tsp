import "../details.tsp";

namespace Vetchium.Problem;

const GlobalCoordinatorAuthenticationRequiredError = #{
  type: "vetchium-problem-details/global-coordinator-authentication-required",
  title: "Global coordinator authentication required",
  status: 401,
  detail: "A valid global coordinator bearer credential is required",
};

alias GlobalCoordinatorAuthenticationRequiredErrorResponse = AuthenticationResponse<
  "Bearer realm=\"global-coordinator\"",
  typeof GlobalCoordinatorAuthenticationRequiredError
>;
