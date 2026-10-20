import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../common/localization.tsp";
import "../../common/pagination.tsp";
import "../../directory/directory.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/marketplace.tsp";
import "../../problem/orgs/suspension.tsp";
import "../hiring/vocabulary.tsp";
import "../types.tsp";
import "./capabilities.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Marketplace;

/** A Listing's version, starting at 1 and rising with every change. */
scalar ListingVersion extends int32;

/**
 * Whether a Listing appears in search. Only `listed` does. A portal older than
 * its API shows a state it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["draft", "listed", "unlisted"]
)
scalar ListingState extends string;

/**
 * Where a provider serves: everywhere (`worldwide`, no countries) or 1 to 250
 * unique countries. A declaration only; Vetchium never refuses an engagement
 * because of it.
 */
model ServiceArea {
  worldwide: boolean;

  @maxItems(250)
  countries: Vetchium.CountryCode[];
}

/**
 * What a provider declares on a Listing. A `background_check` Listing also
 * names the check types it performs and the consent disclosure applicants see
 * before they consent; every other Capability omits both.
 */
model ListingContent {
  /** 1 to 200 code points after trimming. */
  @minLength(1)
  @maxLength(200)
  headline: string;

  /** A Markdown subset, 1 to 10,000 code points after trimming. */
  @minLength(1)
  @maxLength(10000)
  description: string;

  service: ServiceArea;

  /** Language-catalog tags, at most 20, unique. */
  @maxItems(20)
  languages: string[];

  /** Plain text of 1 to 500 code points after trimming. */
  @minLength(1)
  @maxLength(500)
  indicative_price?: string;

  @minItems(1)
  @maxItems(20)
  check_types?: Vetchium.Orgs.Hiring.CheckType[];

  /** Plain text of 1 to 5,000 code points after trimming. */
  @minLength(1)
  @maxLength(5000)
  consent_disclosure?: string;
}

/** An Org's own Listing. */
model Listing {
  capability: Capability;
  state: ListingState;
  version: ListingVersion;
  ...ListingContent;
  created_at: utcDateTime;
  updated_at: utcDateTime;
}

model ListListingsRequest {}

/** At most one Listing per Capability, so the list is never paginated. */
model ListListingsResponse {
  listings: Listing[];
}

model CreateListingRequest {
  capability: Capability;
  ...ListingContent;
}

/** Replaces the whole content of the Listing. */
model UpdateListingRequest {
  capability: Capability;
  version: ListingVersion;
  ...ListingContent;
}

/** Names the Listing an action applies to, and the version it was read at. */
model ListingTarget {
  capability: Capability;
  version: ListingVersion;
}

/** The provider as search and Listing detail show it. */
model ListingProvider {
  domain: Vetchium.Orgs.OrgDomain;
  display_name: string;

  /** Present only when the provider's plan allows a logo and it has one. */
  logo_url?: string;

  country: Vetchium.CountryCode;
}

model ListingSummary {
  provider: ListingProvider;
  capability: Capability;
  headline: string;
  service: ServiceArea;
  languages: string[];
  indicative_price?: string;
  check_types?: Vetchium.Orgs.Hiring.CheckType[];
}

model ListingDetail {
  ...ListingSummary;
  description: string;
  consent_disclosure?: string;
}

/** The most Listings one search page holds. */
@minValue(1)
@maxValue(50)
scalar ListingSearchPageSize extends int32;

model SearchListingsRequest {
  capability: Capability;
  country?: Vetchium.CountryCode;
  language?: string;

  /** Only for `background_check`: Listings that perform all of them. */
  @minItems(1)
  @maxItems(20)
  check_types?: Vetchium.Orgs.Hiring.CheckType[];

  /** A provider name or headline substring of at least 2 code points. */
  @minLength(2)
  @maxLength(200)
  query?: string;

  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: ListingSearchPageSize = 50;
}

model SearchListingsResponse {
  listings: ListingSummary[];

  /**
   * Tenants that did not answer before the deadline. Their Listings are
   * missing from this page, so the results are incomplete.
   */
  unavailable_tenants: Vetchium.Directory.TenantID[];

  next_pagination_key?: Vetchium.PaginationKey;
}

model GetListingRequest {
  domain: Vetchium.Orgs.OrgDomain;
  capability: Capability;
}

alias ListingAccessErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgPermissionRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias ListingBaseErrors =
  | ListingAccessErrors
  | Vetchium.Problem.ValidationFailedErrorResponse;

alias ListingWriteErrors =
  | ListingBaseErrors
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse;

@route("/api/orgs")
@tag("Org Listings")
interface ListingOperations {
  @route("/list-listings")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_listings"
  )
  listListings(@body request: ListListingsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListListingsResponse;
      }
    | ListingAccessErrors;

  @route("/create-listing")
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
  createListing(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: CreateListingRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Listing;
      }
    | ListingWriteErrors
    | Vetchium.Problem.OrgListingPlanRequiredErrorResponse
    | Vetchium.Problem.OrgListingExistsErrorResponse;

  @route("/update-listing")
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
  updateListing(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: UpdateListingRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Listing;
      }
    | ListingWriteErrors
    | Vetchium.Problem.OrgListingPlanRequiredErrorResponse
    | Vetchium.Problem.OrgListingNotFoundErrorResponse
    | Vetchium.Problem.OrgListingVersionConflictErrorResponse;

  /** Moves a draft or unlisted Listing to `listed`. */
  @route("/publish-listing")
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
  publishListing(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ListingTarget,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Listing;
      }
    | ListingWriteErrors
    | Vetchium.Problem.OrgListingPlanRequiredErrorResponse
    | Vetchium.Problem.OrgListingNotFoundErrorResponse
    | Vetchium.Problem.OrgListingVersionConflictErrorResponse
    | Vetchium.Problem.OrgListingStateConflictErrorResponse;

  /** Moves a `listed` Listing to `unlisted`; active engagements continue. */
  @route("/unlist-listing")
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
  unlistListing(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ListingTarget,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Listing;
      }
    | ListingWriteErrors
    | Vetchium.Problem.OrgListingNotFoundErrorResponse
    | Vetchium.Problem.OrgListingVersionConflictErrorResponse
    | Vetchium.Problem.OrgListingStateConflictErrorResponse;

  /** Deletes a draft Listing; any other state is a state conflict. */
  @route("/delete-listing")
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
  deleteListing(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ListingTarget,
  ):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | ListingWriteErrors
    | Vetchium.Problem.OrgListingNotFoundErrorResponse
    | Vetchium.Problem.OrgListingVersionConflictErrorResponse
    | Vetchium.Problem.OrgListingStateConflictErrorResponse;

  /**
   * Asks every tenant for matching `listed` Listings with one deadline and
   * merges them by case-folded provider name, then domain. A tenant that does
   * not answer is named in `unavailable_tenants`.
   */
  @route("/search-listings")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["normalized-filters", "provider-name", "provider-domain"]
  )
  searchListings(@body request: SearchListingsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: SearchListingsResponse;
      }
    | ListingBaseErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  /** Reads a provider's `listed` Listing, in this tenant or another. */
  @route("/get-listing")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
  )
  getListing(@body request: GetListingRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListingDetail;
      }
    | ListingBaseErrors
    | Vetchium.Problem.OrgListingNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;
}
