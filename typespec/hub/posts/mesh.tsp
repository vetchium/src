import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/pagination.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/global-coordinator/authentication.tsp";
import "../../problem/hub/profile.tsp";
import "../types.tsp";
import "./posts.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Posts;

/** A post as the owner's tenant serves it to another tenant. */
model MeshPost {
  ...Post;
  owner_hub_user_did: Vetchium.Hub.HubUserDID;
}

/** The viewer fields come from the local Hub API session. The serving tenant
 * verifies that the calling tenant homes the viewer (PST-RD-003). */
model MeshListPostsRequest {
  owner_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_handle: Vetchium.Hub.HubHandle;
  pagination_key?: Vetchium.PaginationKey;

  /** Default 20. */
  @minValue(1)
  @maxValue(50)
  limit?: int32;
}

model MeshListPostsResponse {
  /** Live posts, newest first. */
  posts: MeshPost[];

  next_pagination_key?: Vetchium.PaginationKey;
}

model MeshPostReference {
  owner_hub_user_did: Vetchium.Hub.HubUserDID;
  post_id: PostID;
}

model MeshGetManyPostsRequest {
  viewer_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_handle: Vetchium.Hub.HubHandle;

  @minItems(1)
  @maxItems(50)
  posts: MeshPostReference[];
}

model MeshPostFound {
  status: "found";
  owner_hub_user_did: Vetchium.Hub.HubUserDID;
  post_id: PostID;
  post: MeshPost;
}

model MeshPostNotFound {
  status: "not-found";
  owner_hub_user_did: Vetchium.Hub.HubUserDID;
  post_id: PostID;
}

/** The serving tenant does not home the owner. */
model MeshPostNotHomed {
  status: "not-homed";
  owner_hub_user_did: Vetchium.Hub.HubUserDID;
  post_id: PostID;
}

alias MeshPostResult = MeshPostFound | MeshPostNotFound | MeshPostNotHomed;

model MeshGetManyPostsResponse {
  /** One result for each requested reference, in request order. */
  results: MeshPostResult[];
}

alias MeshErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubProfileNotFoundErrorResponse
  | Vetchium.Problem.HubProfileUnavailableErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias MeshListPostsResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: MeshListPostsResponse;
    }
  | Vetchium.Problem.InvalidPaginationKeyErrorResponse
  | MeshErrors;

alias MeshGetManyPostsResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: MeshGetManyPostsResponse;
    }
  | MeshErrors;

@route("/mesh/posts")
@tag("Tenant-local post relay")
@useAuth(BearerAuth)
interface PostRelayOperations {
  @route("/list")
  @post
  list(@body request: MeshListPostsRequest):
    | MeshListPostsResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

  @route("/get-many")
  @post
  getMany(@body request: MeshGetManyPostsRequest):
    | MeshGetManyPostsResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/posts")
@tag("Authenticated peer post read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface PostPeerOperations {
  @route("/list")
  @post
  list(@body request: MeshListPostsRequest): MeshListPostsResult;

  @route("/get-many")
  @post
  getMany(@body request: MeshGetManyPostsRequest): MeshGetManyPostsResult;
}
