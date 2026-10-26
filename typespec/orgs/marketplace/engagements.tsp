import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../common/localization.tsp";
import "../../common/pagination.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/marketplace.tsp";
import "../../problem/orgs/suspension.tsp";
import "../operations/operations.tsp";
import "../types.tsp";
import "./capabilities.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Marketplace;

/** An engagement's identifier, minted by the consumer's tenant. */
@format("uuid")
scalar EngagementID extends string;

/** An engagement's version, starting at 1 and rising with every change. */
scalar EngagementVersion extends int32;

/**
 * Where an engagement stands. `proposed` becomes `active`, `declined`,
 * `withdrawn`, or (after 30 days) `expired`; `active` becomes `ended`. A
 * portal older than its API shows a state it does not recognize as the raw
 * value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["proposed", "active", "declined", "withdrawn", "expired", "ended"]
)
scalar EngagementState extends string;

/** Which party ended an engagement. */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["consumer", "provider"]
)
scalar EngagementParty extends string;

/** The other Org of an engagement, as the viewer sees it. */
model EngagementCounterparty {
  domain: Vetchium.Orgs.OrgDomain;
  display_name: string;
}

/**
 * An engagement as one of its two Orgs sees it. `counterparty` is the other
 * Org: the provider for the consumer, the client for the provider. Both
 * sides see both references.
 */
model Engagement {
  id: EngagementID;
  version: EngagementVersion;
  counterparty: EngagementCounterparty;
  capability: Capability;
  state: EngagementState;

  /** The proposal's message, at most 2,000 code points. */
  message?: string;

  /** Plain text of at most 200 code points the consumer keeps. */
  consumer_reference?: string;

  /** Plain text of at most 200 code points the provider keeps. */
  provider_reference?: string;

  /** The note that ended the engagement, at most 2,000 code points. */
  end_note?: string;

  ended_by?: EngagementParty;
  proposed_at: utcDateTime;

  /** When a `proposed` engagement expires. */
  expires_at: utcDateTime;

  decided_at?: utcDateTime;
  ended_at?: utcDateTime;
  updated_at: utcDateTime;
}

model ProposeEngagementRequest {
  provider_domain: Vetchium.Orgs.OrgDomain;
  capability: Capability;

  @minLength(1)
  @maxLength(2000)
  message?: string;
}

/** Names an engagement and the version the caller read. */
model EngagementTarget {
  engagement_id: EngagementID;
  version: EngagementVersion;
}

model EndEngagementRequest {
  engagement_id: EngagementID;
  version: EngagementVersion;

  @minLength(1)
  @maxLength(2000)
  note?: string;
}

/** An absent `reference` clears the caller's own reference. */
model SetEngagementReferenceRequest {
  engagement_id: EngagementID;
  version: EngagementVersion;

  @minLength(1)
  @maxLength(200)
  reference?: string;
}

model GetEngagementRequest {
  engagement_id: EngagementID;
}

/** The most engagements one page holds. */
@minValue(1)
@maxValue(100)
scalar EngagementPageSize extends int32;

model ListEngagementsRequest {
  state?: EngagementState;
  capability?: Capability;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: EngagementPageSize = 50;
}

model ListEngagementsResponse {
  engagements: Engagement[];
  next_pagination_key?: Vetchium.PaginationKey;
}

alias EngagementBaseErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgPermissionRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias EngagementWriteErrors =
  | EngagementBaseErrors
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse;

@route("/api/orgs")
@tag("Org engagements")
interface EngagementOperations {
  /** Lists the Org's engagements as consumer, proposals awaiting a decision first. */
  @route("/list-engagements")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
  )
  listEngagements(@body request: ListEngagementsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListEngagementsResponse;
      }
    | EngagementBaseErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  /** Reads one engagement as consumer. */
  @route("/get-engagement")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
  )
  getEngagement(@body request: GetEngagementRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Engagement;
      }
    | EngagementBaseErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse;

  /** Proposes an engagement on a provider's `listed` Listing. The provider's tenant is read first. */
  @route("/propose-engagement")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
  )
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
  proposeEngagement(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ProposeEngagementRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Engagement;
      }
    | EngagementWriteErrors
    | Vetchium.Problem.OrgListingNotAvailableErrorResponse
    | Vetchium.Problem.OrgEngagementExistsErrorResponse
    | Vetchium.Problem.OrgEngagementSelfErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;

  /** Withdraws a `proposed` engagement. */
  @route("/withdraw-engagement")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
  )
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
  withdrawEngagement(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: EngagementTarget,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Engagement;
      }
    | EngagementWriteErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
    | Vetchium.Problem.OrgEngagementStateConflictErrorResponse
    | Vetchium.Problem.OrgEngagementVersionConflictErrorResponse;

  /** Ends an `active` engagement as the consumer. */
  @route("/end-engagement")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
  )
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
  endEngagement(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: EndEngagementRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Engagement;
      }
    | EngagementWriteErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
    | Vetchium.Problem.OrgEngagementStateConflictErrorResponse
    | Vetchium.Problem.OrgEngagementVersionConflictErrorResponse;

  /** Sets or clears the consumer's own agreement reference. */
  @route("/set-engagement-reference")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
  )
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
  setEngagementReference(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SetEngagementReferenceRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Engagement;
      }
    | EngagementWriteErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
    | Vetchium.Problem.OrgEngagementVersionConflictErrorResponse;

  /** Lists the Org's engagements as provider from this tenant's projection, proposals awaiting a decision first. */
  @route("/list-client-engagements")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_listings"
  )
  listClientEngagements(@body request: ListEngagementsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListEngagementsResponse;
      }
    | EngagementBaseErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  /** Reads one engagement as provider from this tenant's projection. */
  @route("/get-client-engagement")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_listings"
  )
  getClientEngagement(@body request: GetEngagementRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Engagement;
      }
    | EngagementBaseErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse;

  /** Accepts a `proposed` engagement as the provider; a durable command to the consumer's tenant. */
  @route("/accept-engagement")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_listings"
  )
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
  acceptEngagement(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: EngagementTarget,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Engagement;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Operations.PendingOperation;
      }
    | EngagementWriteErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
    | Vetchium.Problem.OrgEngagementStateConflictErrorResponse
    | Vetchium.Problem.OrgEngagementVersionConflictErrorResponse
    | Vetchium.Problem.OrgListingNotAvailableErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;

  /** Declines a `proposed` engagement as the provider. */
  @route("/decline-engagement")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_listings"
  )
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
  declineEngagement(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: EngagementTarget,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Engagement;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Operations.PendingOperation;
      }
    | EngagementWriteErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
    | Vetchium.Problem.OrgEngagementStateConflictErrorResponse
    | Vetchium.Problem.OrgEngagementVersionConflictErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;

  /** Ends an `active` engagement as the provider. */
  @route("/end-client-engagement")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_listings"
  )
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
  endClientEngagement(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: EndEngagementRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Engagement;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Operations.PendingOperation;
      }
    | EngagementWriteErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
    | Vetchium.Problem.OrgEngagementStateConflictErrorResponse
    | Vetchium.Problem.OrgEngagementVersionConflictErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;

  /** Sets or clears the provider's own agreement reference. */
  @route("/set-client-engagement-reference")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_listings"
  )
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
  setClientEngagementReference(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SetEngagementReferenceRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Engagement;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Operations.PendingOperation;
      }
    | EngagementWriteErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
    | Vetchium.Problem.OrgEngagementVersionConflictErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;
}
