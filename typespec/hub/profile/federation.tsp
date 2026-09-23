import "@typespec/http";

import "../../common/authentication.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/global-coordinator/authentication.tsp";
import "../../problem/hub/profile.tsp";
import "../types.tsp";
import "./public.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Profile;

/** Sent only by the local Hub API after authenticating the viewer. */
model RelayReadProfileRequest {
  viewer_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_handle: Vetchium.Hub.HubHandle;
  address: ProfileAddress;
}

/** The receiver verifies the viewer's permanent handle and DID against the
 * global directory and the caller tenant derived from its mTLS certificate. */
model PeerReadProfileRequest {
  viewer_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_handle: Vetchium.Hub.HubHandle;
  target_hub_user_did: Vetchium.Hub.HubUserDID;
}

alias FederatedReadResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: PublicProfile;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubProfileNotFoundErrorResponse
  | Vetchium.Problem.HubProfileUnavailableErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

@route("/mesh/profile")
@tag("Tenant-local profile relay")
@useAuth(BearerAuth)
interface ProfileRelayOperations {
  @route("/read")
  @post
  read(@body request: RelayReadProfileRequest):
    | FederatedReadResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/profile")
@tag("Authenticated peer profile read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface ProfilePeerOperations {
  @route("/read")
  @post
  read(@body request: PeerReadProfileRequest): FederatedReadResult;
}
