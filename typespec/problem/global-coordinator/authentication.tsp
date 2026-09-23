import "../details.tsp";

namespace Vetchium.Problem;

const GlobalCoordinatorAuthenticationRequiredError = #{
  type: "vetchium-problem-details/global-coordinator-authentication-required",
  title: "Global coordinator authentication required",
  status: 401,
  detail: "A private-CA verified tenant mesh client certificate is required",
};

alias GlobalCoordinatorAuthenticationRequiredErrorResponse = AuthenticationResponse<
  "MutualTLS realm=\"global-coordinator\"",
  typeof GlobalCoordinatorAuthenticationRequiredError
>;

const MeshRelayAuthenticationRequiredError = #{
  type: "vetchium-problem-details/mesh-relay-authentication-required",
  title: "Mesh relay authentication required",
  status: 401,
  detail: "A valid tenant-local mesh relay credential is required",
};

alias MeshRelayAuthenticationRequiredErrorResponse = AuthenticationResponse<
  "Bearer realm=\"mesh-api\"",
  typeof MeshRelayAuthenticationRequiredError
>;
