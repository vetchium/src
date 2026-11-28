import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/localization.tsp";
import "../../directory/directory.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/global-coordinator/authentication.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/profile.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Profile;

/** The fields another Hub user sees beside a post or a reply. */
model ProfileCard {
  handle: Vetchium.Hub.HubHandle;
  `alias`?: Vetchium.Directory.HubAlias;
  display_name: Vetchium.DisplayName;
  picture_url?: url;
}

model ReadCardsRequest {
  @minItems(1)
  @maxItems(50)
  handles: Vetchium.Hub.HubHandle[];
}

model ReadCardsResponse {
  cards: ProfileCard[];

  /** Handles whose region did not answer in time. */
  unavailable: Vetchium.Hub.HubHandle[];
}

/** Sent only by the local Hub API after authenticating the viewer. */
model RelayReadCardsRequest {
  viewer_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_handle: Vetchium.Hub.HubHandle;

  @minItems(1)
  @maxItems(50)
  handles: Vetchium.Hub.HubHandle[];
}

/** The receiver verifies the viewer as for `/api/mesh/profile/read`. */
model PeerReadCardsRequest {
  viewer_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_handle: Vetchium.Hub.HubHandle;

  @minItems(1)
  @maxItems(50)
  handles: Vetchium.Hub.HubHandle[];
}

alias ReadCardsErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

@route("/api/hub/profile")
@tag("Hub profile cards")
interface ProfileCardOperations {
  @route("/read-cards")
  @post
  @useAuth(BearerAuth)
  readCards(@body request: ReadCardsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ReadCardsResponse;
      }
    | ReadCardsErrors
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse;
}

alias PeerReadCardsResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: ReadCardsResponse;
    }
  | ReadCardsErrors
  | Vetchium.Problem.HubProfileNotFoundErrorResponse
  | Vetchium.Problem.HubProfileUnavailableErrorResponse;

@route("/mesh/profile")
@tag("Tenant-local profile card relay")
@useAuth(BearerAuth)
interface ProfileCardRelayOperations {
  @route("/read-cards")
  @post
  readCards(@body request: RelayReadCardsRequest):
    | PeerReadCardsResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/profile")
@tag("Authenticated peer profile card read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface ProfileCardPeerOperations {
  @route("/read-cards")
  @post
  readCards(@body request: PeerReadCardsRequest): PeerReadCardsResult;
}
