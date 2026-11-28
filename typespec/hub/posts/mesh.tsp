import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/pagination.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/global-coordinator/authentication.tsp";
import "../../problem/hub/posts.tsp";
import "../../problem/hub/profile.tsp";
import "../../directory/directory.tsp";
import "../types.tsp";
import "./posts.tsp";
import "./replies.tsp";

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

/** A reply as the post owner's tenant serves it. The author DID lets the
 * viewer's tenant filter muted authors (PST-THR-005). */
model MeshReply {
  ...Reply;
  author_hub_user_did: Vetchium.Hub.HubUserDID;
}

model MeshListRepliesRequest {
  owner_hub_user_did: Vetchium.Hub.HubUserDID;
  post_id: PostID;
  parent_reply_id?: PostID;
  viewer_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_handle: Vetchium.Hub.HubHandle;
  pagination_key?: Vetchium.PaginationKey;

  /** Default 20. */
  @minValue(1)
  @maxValue(50)
  limit?: int32;
}

model MeshListRepliesResponse {
  /** Oldest first. */
  replies: MeshReply[];

  next_pagination_key?: Vetchium.PaginationKey;
}

model MeshGetReplyRequest {
  owner_hub_user_did: Vetchium.Hub.HubUserDID;
  post_id: PostID;
  reply_id: PostID;
  viewer_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_handle: Vetchium.Hub.HubHandle;
}

/** What the replier's tenant needs before a sub-reply (PST-RPL-004). It holds
 * no words. */
model MeshGetReplyResponse {
  reply_id: PostID;
  post_id: PostID;
  parent_reply_id?: PostID;
  author_hub_user_did: Vetchium.Hub.HubUserDID;
  author_tenant_id: Vetchium.Directory.TenantID;
  author_handle: Vetchium.Hub.HubHandle;
  state: ThreadReplyState;
}

model MeshListAuthorRepliesRequest {
  author_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_hub_user_did: Vetchium.Hub.HubUserDID;
  viewer_handle: Vetchium.Hub.HubHandle;
  pagination_key?: Vetchium.PaginationKey;

  /** Default 20. */
  @minValue(1)
  @maxValue(50)
  limit?: int32;
}

model MeshListAuthorRepliesResponse {
  /** Newest first. */
  replies: AuthorReply[];

  next_pagination_key?: Vetchium.PaginationKey;
}

alias MeshErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubProfileNotFoundErrorResponse
  | Vetchium.Problem.HubProfileUnavailableErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias MeshReplyErrors =
  | MeshErrors
  | Vetchium.Problem.HubPostNotFoundErrorResponse
  | Vetchium.Problem.HubReplyNotFoundErrorResponse;

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

alias MeshListRepliesResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: MeshListRepliesResponse;
    }
  | Vetchium.Problem.InvalidPaginationKeyErrorResponse
  | MeshReplyErrors;

alias MeshGetReplyResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: MeshGetReplyResponse;
    }
  | MeshReplyErrors;

alias MeshListAuthorRepliesResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: MeshListAuthorRepliesResponse;
    }
  | Vetchium.Problem.InvalidPaginationKeyErrorResponse
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

  @route("/list-replies")
  @post
  listReplies(@body request: MeshListRepliesRequest):
    | MeshListRepliesResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

  @route("/get-reply")
  @post
  getReply(@body request: MeshGetReplyRequest):
    | MeshGetReplyResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

  @route("/list-author-replies")
  @post
  listAuthorReplies(@body request: MeshListAuthorRepliesRequest):
    | MeshListAuthorRepliesResult
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

  @route("/list-replies")
  @post
  listReplies(@body request: MeshListRepliesRequest): MeshListRepliesResult;

  @route("/get-reply")
  @post
  getReply(@body request: MeshGetReplyRequest): MeshGetReplyResult;

  @route("/list-author-replies")
  @post
  listAuthorReplies(
    @body request: MeshListAuthorRepliesRequest,
  ): MeshListAuthorRepliesResult;
}
