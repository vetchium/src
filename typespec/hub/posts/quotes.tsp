import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/pagination.tsp";
import "../../orgs/types.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/openings.tsp";
import "../../problem/hub/posts.tsp";
import "../openings/public.tsp";
import "../profile/public.tsp";
import "../types.tsp";
import "./posts.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Posts;

enum QuoteTargetType {
  TimelinePost: "timeline_post",
  Opening: "opening",
}

/** A quote of a live timeline post. The `owner` of a request may be an alias;
 * in a response it is the permanent handle (PST-OWN-004). */
model TimelinePostQuoteTarget {
  type: QuoteTargetType.TimelinePost;
  owner: Vetchium.Hub.Profile.ProfileAddress;
  post_id: PostID;
}

/** A quote of a published Opening (PST-QTE-011). */
model OpeningQuoteTarget {
  type: QuoteTargetType.Opening;
  org_domain: Vetchium.Orgs.OrgDomain;
  opening_number: Vetchium.Hub.Openings.OpeningNumber;
}

/** Discriminated on `type`. A quote of a reply is not allowed (PST-QTE-002). */
alias QuoteTarget = TimelinePostQuoteTarget | OpeningQuoteTarget;

/** The Opening an embed shows. It is always `published`. */
model EmbeddedOpening {
  org: Vetchium.Hub.Openings.PublicOrg;
  opening: Vetchium.Hub.Openings.PublicOpeningSummary;
}

model PostEmbedPost {
  state: "post";
  post: EmbeddedPost;
}

model PostEmbedOpening {
  state: "opening";
  opening: EmbeddedOpening;
}

/** The target is detached, removed, missing, or not published. The portal
 * shows "This post is not available" (PST-QTE-009). */
model PostEmbedUnavailable {
  state: "unavailable";
}

/** Discriminated on `state`. */
alias PostEmbed = PostEmbedPost | PostEmbedOpening | PostEmbedUnavailable;

model CreateQuoteRequest {
  target: QuoteTarget;
  body: PostBody;

  /** Default `everyone`. */
  reply_policy?: ReplyPolicy;

  /** Default `everyone`. */
  quote_policy?: QuotePolicy;
}

model ListQuotesRequest {
  owner: Vetchium.Hub.Profile.ProfileAddress;
  post_id: PostID;
  pagination_key?: Vetchium.PaginationKey;

  /** Default 20. */
  @minValue(1)
  @maxValue(50)
  limit?: int32;
}

model ListQuotesResponse {
  /** Quote posts, newest first. */
  posts: Post[];

  /** A region did not answer, so the page can miss quotes (PST-QTE-012). */
  partial: boolean;

  next_pagination_key?: Vetchium.PaginationKey;
}

model DetachQuoteRequest {
  post_id: PostID;
  quoter: Vetchium.Hub.Profile.ProfileAddress;
  quote_post_id: PostID;
}

@route("/api/hub/posts")
@tag("Hub posts")
interface QuoteOperations {
  /**
   * Quotes a timeline post or a published Opening. Every tier may quote. A
   * repeat with the same key replays the stored response.
   */
  @route("/create-quote")
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
  createQuote(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: CreateQuoteRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Post;
      }
    | PostErrors
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.HubPostNotFoundErrorResponse
    | Vetchium.Problem.HubPostQuoteRefusedErrorResponse
    | Vetchium.Problem.HubOpeningNotFoundErrorResponse
    | Vetchium.Problem.HubPostUnavailableErrorResponse
    | Vetchium.Problem.HubPostLimitReachedErrorResponse;

  @route("/list-quotes")
  @post
  @useAuth(BearerAuth)
  listQuotes(@body request: ListQuotesRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListQuotesResponse;
      }
    | PostErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.HubPostNotFoundErrorResponse
    | Vetchium.Problem.HubPostUnavailableErrorResponse;

  /** The target post owner detaches a quote (PST-QTE-008). */
  @route("/detach-quote")
  @post
  @useAuth(BearerAuth)
  detachQuote(@body request: DetachQuoteRequest):
    | NoContent
    | PostErrors
    | Vetchium.Problem.HubPostNotFoundErrorResponse
    | Vetchium.Problem.HubPostUnavailableErrorResponse;
}
