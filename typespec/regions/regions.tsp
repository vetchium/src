import "@typespec/http";
import "../common/localization.tsp";
import "../common/pagination.tsp";
import "../problem/common.tsp";
import "../problem/details.tsp";
import "../problem/global-coordinator/authentication.tsp";
using TypeSpec.Http;
namespace Vetchium.Regions;
model ListSignupRegionsRequest {
  resident_country: CountryCode;
  pagination_key?: PaginationKey;
}
model SignupRegion {
  tenant_id: string;
  hosting_country: CountryCode;
  hub_url: url;
  recommended: boolean;
}
model ListSignupRegionsResponse {
  catalog_version: string;
  regions: SignupRegion[];
  next_pagination_key: PaginationKey | null;
}
alias ListResponse =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: ListSignupRegionsResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.InvalidPaginationKeyErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;
@route("/api/hub")
@tag("Hub signup")
interface HubOperations {
  /** List eligible regions ordered by tenant ID, in pages of 50. Cursors bind country and catalog version. */
  @route("/list-signup-regions")
  @post
  listSignupRegions(@body request: ListSignupRegionsRequest): ListResponse;
}
@route("/api/global-coordinator")
@tag("Global coordinator")
interface GlobalOperations {
  /** Discover signup regions over the authenticated private mesh. */
  @route("/list-signup-regions")
  @post
  @useAuth(BearerAuth)
  listSignupRegions(@body request: ListSignupRegionsRequest):
    | ListResponse
    | Vetchium.Problem.GlobalCoordinatorAuthenticationRequiredErrorResponse;
}
@route("/mesh")
@tag("Mesh discovery")
interface MeshOperations {
  /** Relay global discovery, using the tenant's bundled catalog during outages. */
  @route("/list-signup-regions")
  @post
  @useAuth(BearerAuth)
  listSignupRegions(@body request: ListSignupRegionsRequest):
    | ListResponse
    | Vetchium.Problem.GlobalCoordinatorAuthenticationRequiredErrorResponse;
}
