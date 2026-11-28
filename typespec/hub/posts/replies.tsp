import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../common/pagination.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/posts.tsp";
import "../../problem/hub/profile.tsp";
import "../operations/operations.tsp";
import "../profile/public.tsp";
import "../types.tsp";
import "./posts.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Posts;

/**
 * How a reply shows in a thread for one viewer. `hidden` is the post owner's
 * hide, shown with its words only to the reply's author. `placeholder` stands
 * in for a reply that is not live but has sub-replies (PST-THR-004); it has
 * no body.
 */
enum ThreadReplyState {
  Live: "live",
  Hidden: "hidden",
  Placeholder: "placeholder",
}

model Reply {
  reply_id: PostID;
  post_id: PostID;

  /** Set on a sub-reply. */
  parent_reply_id?: PostID;

  author_handle: Vetchium.Hub.HubHandle;

  /** Absent when `state` is `placeholder`. */
  body?: PostBody;

  state: ThreadReplyState;

  /** The live sub-replies. */
  child_count: int32;

  revision: int32;
  edited: boolean;
  created_at: utcDateTime;
}

/** Replies below a top-level reply only; a reply to a sub-reply is refused. */
model ReplyRequest {
  owner: Vetchium.Hub.Profile.ProfileAddress;
  post_id: PostID;
  parent_reply_id?: PostID;
  body: PostBody;
}

model EditReplyRequest {
  reply_id: PostID;
  body: PostBody;

  /** The revision the caller read. A stale value is a conflict. */
  revision: int32;
}

model RemoveReplyRequest {
  reply_id: PostID;
}

/** For `/hide-reply` and `/unhide-reply`. */
model HideReplyRequest {
  post_id: PostID;
  reply_id: PostID;
}

model ListRepliesRequest {
  owner: Vetchium.Hub.Profile.ProfileAddress;
  post_id: PostID;

  /** Lists the sub-replies of this top-level reply. Absent lists top-level
   * replies. */
  parent_reply_id?: PostID;

  /**
   * Starts the page at this reply of the list, for a reply link
   * (PST-THR-009). Not with `pagination_key`.
   */
  from_reply_id?: PostID;

  pagination_key?: Vetchium.PaginationKey;

  /** Default 20. */
  @minValue(1)
  @maxValue(50)
  limit?: int32;
}

model ListRepliesResponse {
  /** Oldest first. A page can be short; the list ends when the next key is
   * absent. */
  replies: Reply[];

  next_pagination_key?: Vetchium.PaginationKey;
}

/** `post_removed` keeps the reply on the Replies tab with no link
 * (PST-TAB-002). */
enum AuthorReplyState {
  Live: "live",
  PostRemoved: "post_removed",
}

/** A reply as the Replies tab shows it. It never holds post words. */
model AuthorReply {
  reply_id: PostID;
  post_id: PostID;
  post_owner_handle: Vetchium.Hub.HubHandle;

  /** Absent when `state` is `post_removed` (PST-TAB-002). */
  body?: PostBody;

  state: AuthorReplyState;
  edited: boolean;
  created_at: utcDateTime;
}

/** Names one reply of one post, for a reply link (PST-THR-009). */
model LocateReplyRequest {
  owner: Vetchium.Hub.Profile.ProfileAddress;
  post_id: PostID;
  reply_id: PostID;
}

model LocateReplyResponse {
  reply_id: PostID;

  /** Set when the reply is a sub-reply. */
  parent_reply_id?: PostID;
}

model ListAuthorRepliesRequest {
  owner: Vetchium.Hub.Profile.ProfileAddress;
  pagination_key?: Vetchium.PaginationKey;

  /** Default 20. */
  @minValue(1)
  @maxValue(50)
  limit?: int32;
}

model ListAuthorRepliesResponse {
  /** Newest first. Empty when `muted` is true. */
  replies: AuthorReply[];

  /** The caller muted the owner (PST-BLK-005). */
  muted: boolean;

  next_pagination_key?: Vetchium.PaginationKey;
}

alias PendingReplyResponse = {
  @statusCode status_code: 202;
  @header("Cache-Control") cache_control: "no-store";
  @body body: Vetchium.Hub.Operations.PendingOperation;
};

alias ReplyResult = {
  @statusCode status_code: 200;
  @header("Cache-Control") cache_control: "no-store";
  @body body: Reply;
};

@route("/api/hub/posts")
@tag("Hub posts")
interface ReplyOperations {
  /**
   * Replies to a post or to a top-level reply. It returns `202` while the
   * command to the post owner's tenant is pending.
   */
  @route("/reply")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  reply(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ReplyRequest,
  ):
    | ReplyResult
    | PendingReplyResponse
    | PostErrors
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.HubPostNotFoundErrorResponse
    | Vetchium.Problem.HubPostRepliesClosedErrorResponse
    | Vetchium.Problem.HubPostReplyRefusedErrorResponse
    | Vetchium.Problem.HubReplyNotFoundErrorResponse
    | Vetchium.Problem.HubPostLimitReachedErrorResponse
    | Vetchium.Problem.HubPostUnavailableErrorResponse;

  /** Edits the words of the caller's own reply for 30 minutes. */
  @route("/edit-reply")
  @post
  @useAuth(BearerAuth)
  editReply(@body request: EditReplyRequest):
    | ReplyResult
    | PostErrors
    | Vetchium.Problem.HubReplyNotFoundErrorResponse
    | Vetchium.Problem.HubPostEditClosedErrorResponse
    | Vetchium.Problem.HubPostConflictErrorResponse;

  /** Clears the words of the caller's own reply and marks it removed. */
  @route("/remove-reply")
  @post
  @useAuth(BearerAuth)
  removeReply(@body request: RemoveReplyRequest):
    | NoContent
    | PostErrors
    | Vetchium.Problem.HubReplyNotFoundErrorResponse;

  /** The post owner hides a reply from other viewers. */
  @route("/hide-reply")
  @post
  @useAuth(BearerAuth)
  hideReply(@body request: HideReplyRequest):
    | NoContent
    | PostErrors
    | Vetchium.Problem.HubReplyNotFoundErrorResponse;

  @route("/unhide-reply")
  @post
  @useAuth(BearerAuth)
  unhideReply(@body request: HideReplyRequest):
    | NoContent
    | PostErrors
    | Vetchium.Problem.HubReplyNotFoundErrorResponse;

  @route("/list-replies")
  @post
  @useAuth(BearerAuth)
  listReplies(@body request: ListRepliesRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListRepliesResponse;
      }
    | PostErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.HubPostNotFoundErrorResponse
    | Vetchium.Problem.HubReplyNotFoundErrorResponse
    | Vetchium.Problem.HubPostUnavailableErrorResponse;
  /** Finds the list a reply is in, for a reply link (PST-THR-009). */
  @route("/locate-reply")
  @post
  @useAuth(BearerAuth)
  locateReply(@body request: LocateReplyRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: LocateReplyResponse;
      }
    | PostErrors
    | Vetchium.Problem.HubPostNotFoundErrorResponse
    | Vetchium.Problem.HubReplyNotFoundErrorResponse
    | Vetchium.Problem.HubPostUnavailableErrorResponse;

  /** The replies of one Hub user, for the profile Replies tab. */
  @route("/list-author-replies")
  @post
  @useAuth(BearerAuth)
  listAuthorReplies(@body request: ListAuthorRepliesRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListAuthorRepliesResponse;
      }
    | PostErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.HubProfileNotFoundErrorResponse
    | Vetchium.Problem.HubPostUnavailableErrorResponse;
}
