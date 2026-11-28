import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/localization.tsp";
import "../../common/pagination.tsp";
import "../../directory/directory.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/posts.tsp";
import "../../problem/hub/profile.tsp";
import "../../problem/hub/subscriptions.tsp";
import "../types.tsp";
import "../profile/public.tsp";
import "./quotes.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Posts;

/** A post ID: a 20-character XID, then 20 random characters (PST-ID-001). */
@pattern("^[0-9a-v]{20}[0-9a-z]{20}$")
scalar PostID extends string;

/** Plain text of 1 to 512 code points after trimming, without U+0000. */
@maxLength(512)
scalar PostBody extends string;

enum PostKind {
  Post: "post",
  Quote: "quote",
}

enum ReplyPolicy {
  Everyone: "everyone",
  Nobody: "nobody",
}

enum QuotePolicy {
  Everyone: "everyone",
  Nobody: "nobody",
}

/** The owner card fields come from the owner's tenant at read time. */
model PostOwner {
  handle: Vetchium.Hub.HubHandle;
  `alias`?: Vetchium.Directory.HubAlias;
  display_name: Vetchium.DisplayName;
  picture_url?: url;
}

/**
 * A post as an embed shows it: the `Post` fields without its own `embed`
 * (PST-QTE-010). A quote inside an embed keeps only `quote_target`.
 */
model EmbeddedPost {
  post_id: PostID;
  owner: PostOwner;
  kind: PostKind;
  body: PostBody;
  reply_policy: ReplyPolicy;
  quote_policy: QuotePolicy;
  locked: boolean;
  reply_count: int32;
  quote_count: int32;
  revision: int32;
  edited: boolean;
  created_at: utcDateTime;
  edited_at?: utcDateTime;

  /** Set when `kind` is `quote`. The `owner` of a timeline target is the
   * permanent handle. */
  quote_target?: QuoteTarget;
}

model Post {
  ...EmbeddedPost;

  /** The target of a quote, read at response time (PST-QTE-009). Absent
   * when `kind` is `post`. */
  embed?: PostEmbed;
}

model CreatePostRequest {
  body: PostBody;

  /** Default `everyone`. */
  reply_policy?: ReplyPolicy;

  /** Default `everyone`. */
  quote_policy?: QuotePolicy;
}

model EditPostRequest {
  post_id: PostID;
  body: PostBody;

  /** The revision the caller read. A stale value is a conflict. */
  revision: int32;
}

model RemovePostRequest {
  post_id: PostID;
}

model SetPostPoliciesRequest {
  post_id: PostID;
  reply_policy: ReplyPolicy;
  quote_policy: QuotePolicy;
  locked: boolean;
}

model ListPostsRequest {
  owner: Vetchium.Hub.Profile.ProfileAddress;
  pagination_key?: Vetchium.PaginationKey;

  /** Default 20. */
  @minValue(1)
  @maxValue(50)
  limit?: int32;
}

model GetPostRequest {
  owner: Vetchium.Hub.Profile.ProfileAddress;
  post_id: PostID;
}

model ListPostsResponse {
  /** Live posts, newest first. Empty when `muted` is true. */
  posts: Post[];

  /** The caller muted the owner (PST-BLK-005). */
  muted: boolean;

  next_pagination_key?: Vetchium.PaginationKey;
}

alias PostErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias PostResult = {
  @statusCode status_code: 200;
  @header("Cache-Control") cache_control: "no-store";
  @body body: Post;
};

alias NoContent = {
  @statusCode status_code: 204;
};

@route("/api/hub/posts")
@tag("Hub posts")
interface PostOperations {
  /** Creates a top-level post. It needs Silver or higher. */
  @route("/create")
  @post
  @useAuth(BearerAuth)
  create(@body request: CreatePostRequest):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Post;
      }
    | PostErrors
    | Vetchium.Problem.HubPlanRequiredErrorResponse
    | Vetchium.Problem.HubPostLimitReachedErrorResponse;

  /** Edits the words for 30 minutes after creation. */
  @route("/edit")
  @post
  @useAuth(BearerAuth)
  edit(@body request: EditPostRequest):
    | PostResult
    | PostErrors
    | Vetchium.Problem.HubPostNotFoundErrorResponse
    | Vetchium.Problem.HubPostEditClosedErrorResponse
    | Vetchium.Problem.HubPostConflictErrorResponse
    | Vetchium.Problem.HubPlanRequiredErrorResponse;

  /** Clears the words and marks the post removed. */
  @route("/remove")
  @post
  @useAuth(BearerAuth)
  remove(@body request: RemovePostRequest):
    | NoContent
    | PostErrors
    | Vetchium.Problem.HubPostNotFoundErrorResponse;

  @route("/set-policies")
  @post
  @useAuth(BearerAuth)
  setPolicies(@body request: SetPostPoliciesRequest):
    | PostResult
    | PostErrors
    | Vetchium.Problem.HubPostNotFoundErrorResponse;

  @route("/list")
  @post
  @useAuth(BearerAuth)
  list(@body request: ListPostsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListPostsResponse;
      }
    | PostErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.HubProfileNotFoundErrorResponse
    | Vetchium.Problem.HubPostUnavailableErrorResponse;

  @route("/get")
  @post
  @useAuth(BearerAuth)
  get(@body request: GetPostRequest):
    | PostResult
    | PostErrors
    | Vetchium.Problem.HubPostNotFoundErrorResponse
    | Vetchium.Problem.HubPostUnavailableErrorResponse;
}
