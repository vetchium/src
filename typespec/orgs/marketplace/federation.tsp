import "@typespec/http";

import "../../common/authentication.tsp";
import "../../directory/directory.tsp";
import "../../problem/common.tsp";
import "../../problem/global-coordinator/authentication.tsp";
import "../../problem/orgs/marketplace.tsp";
import "./listings.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Marketplace;

/**
 * Where the next page of a merged search resumes: after this provider name,
 * case-folded by the tenant that holds it, then this domain.
 */
model ListingSearchPosition {
  @minLength(1)
  @maxLength(400)
  sort_name: string;

  domain: Vetchium.Orgs.OrgDomain;
}

/**
 * One tenant's share of a Listing search. No caller identity crosses the mesh:
 * the tenant returns only what any active Org may read.
 */
model PeerSearchListingsRequest {
  capability: Capability;
  country?: Vetchium.CountryCode;
  language?: string;

  @minItems(1)
  @maxItems(20)
  check_types?: Vetchium.Orgs.Hiring.CheckType[];

  @minLength(2)
  @maxLength(200)
  query?: string;

  after?: ListingSearchPosition;
  limit: ListingSearchPageSize;
}

/** A Listing with the case-folded provider name the tenant ordered it by. */
model PeerListingSummary {
  sort_name: string;
  listing: ListingSummary;
}

model PeerSearchListingsResponse {
  listings: PeerListingSummary[];

  /** Whether the tenant holds more matches after the last one returned. */
  has_more: boolean;
}

/** Asks the local relay to search `tenant`, which may be this tenant. */
model RelaySearchListingsRequest {
  tenant: Vetchium.Directory.TenantID;
  search: PeerSearchListingsRequest;
}

model RelayGetListingRequest {
  tenant: Vetchium.Directory.TenantID;
  listing: GetListingRequest;
}

alias PeerListingReadErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

@route("/mesh/listings")
@tag("Tenant-local Listing relay")
@useAuth(BearerAuth)
interface ListingRelayOperations {
  @route("/search")
  @post
  search(@body request: RelaySearchListingsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PeerSearchListingsResponse;
      }
    | PeerListingReadErrors
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

  @route("/get")
  @post
  get(@body request: RelayGetListingRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListingDetail;
      }
    | PeerListingReadErrors
    | Vetchium.Problem.OrgListingNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/listings")
@tag("Authenticated peer Listing read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface ListingPeerOperations {
  @route("/search")
  @post
  search(@body request: PeerSearchListingsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PeerSearchListingsResponse;
      }
    | PeerListingReadErrors
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;

  @route("/get")
  @post
  get(@body request: GetListingRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListingDetail;
      }
    | PeerListingReadErrors
    | Vetchium.Problem.OrgListingNotFoundErrorResponse
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;
}
