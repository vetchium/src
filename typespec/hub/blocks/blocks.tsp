import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/pagination.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/profile.tsp";
import "../types.tsp";
import "../profile/public.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Blocks;

/** Names one other Hub user by handle or active alias. */
model BlockUserRequest {
  user: Vetchium.Hub.Profile.ProfileAddress;
}

model ListBlockedUsersRequest {
  pagination_key?: Vetchium.PaginationKey;

  /** Default 20. */
  @minValue(1)
  @maxValue(50)
  limit?: int32;
}

model BlockedUser {
  handle: Vetchium.Hub.HubHandle;
  created_at: utcDateTime;
}

model ListBlockedUsersResponse {
  /** Newest first. */
  users: BlockedUser[];

  next_pagination_key?: Vetchium.PaginationKey;
}

model ListMutedUsersRequest {
  pagination_key?: Vetchium.PaginationKey;

  /** Default 20. */
  @minValue(1)
  @maxValue(50)
  limit?: int32;
}

model MutedUser {
  handle: Vetchium.Hub.HubHandle;
  created_at: utcDateTime;
}

model ListMutedUsersResponse {
  /** Newest first. */
  users: MutedUser[];

  next_pagination_key?: Vetchium.PaginationKey;
}

/** Whether the caller blocked and muted one user. */
model BlockState {
  blocked: boolean;
  muted: boolean;
}

alias BlockErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
  | Vetchium.Problem.HubProfileUnavailableErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias UserBlockErrors =
  | BlockErrors
  | Vetchium.Problem.HubProfileNotFoundErrorResponse;

alias ListBlockErrors =
  | BlockErrors
  | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

alias NoContent = {
  @statusCode status_code: 204;
};

@route("/api/hub/blocks")
@tag("Hub blocks")
interface BlockOperations {
  /** Blocks a user. A repeat call changes nothing. */
  @route("/block")
  @post
  @useAuth(BearerAuth)
  block(@body request: BlockUserRequest): NoContent | UserBlockErrors;

  /** Removes a block. A repeat call changes nothing. */
  @route("/unblock")
  @post
  @useAuth(BearerAuth)
  unblock(@body request: BlockUserRequest): NoContent | UserBlockErrors;

  @route("/list")
  @post
  @useAuth(BearerAuth)
  list(@body request: ListBlockedUsersRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListBlockedUsersResponse;
      }
    | ListBlockErrors;

  @route("/state")
  @post
  @useAuth(BearerAuth)
  state(@body request: BlockUserRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: BlockState;
      }
    | UserBlockErrors;
}

@route("/api/hub/mutes")
@tag("Hub mutes")
interface MuteOperations {
  /** Mutes a user. A repeat call changes nothing. */
  @route("/mute")
  @post
  @useAuth(BearerAuth)
  mute(@body request: BlockUserRequest): NoContent | UserBlockErrors;

  /** Removes a mute. A repeat call changes nothing. */
  @route("/unmute")
  @post
  @useAuth(BearerAuth)
  unmute(@body request: BlockUserRequest): NoContent | UserBlockErrors;

  @route("/list")
  @post
  @useAuth(BearerAuth)
  list(@body request: ListMutedUsersRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListMutedUsersResponse;
      }
    | ListBlockErrors;
}

/** Sent only by the local Hub API after authenticating the viewer. The viewer
 * is the user the blocker may have blocked. */
model CheckBlockRequest {
  blocker_hub_user_did: Vetchium.Hub.HubUserDID;
  blocked_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_handle: Vetchium.Hub.HubHandle;
}

model CheckBlockResponse {
  blocked: boolean;
}

alias CheckBlockResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: CheckBlockResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubProfileNotFoundErrorResponse
  | Vetchium.Problem.HubProfileUnavailableErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

@route("/mesh/blocks")
@tag("Tenant-local block relay")
@useAuth(BearerAuth)
interface BlockRelayOperations {
  @route("/check")
  @post
  check(@body request: CheckBlockRequest):
    | CheckBlockResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/blocks")
@tag("Authenticated peer block check")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface BlockPeerOperations {
  @route("/check")
  @post
  check(@body request: CheckBlockRequest): CheckBlockResult;
}
