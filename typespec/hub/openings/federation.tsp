import "@typespec/http";

import "../../common/authentication.tsp";
import "../../problem/global-coordinator/authentication.tsp";
import "./public.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Openings;

/** No viewer identity crosses the mesh for Org or Opening reads. */
alias RelayListOrgOpeningsRequest = ListOrgOpeningsRequest;
alias RelayGetOrgOpeningRequest = GetOrgOpeningRequest;
alias PeerListOrgOpeningsRequest = ListOrgOpeningsRequest;
alias PeerGetOrgOpeningRequest = GetOrgOpeningRequest;

alias PeerReadErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubOrgNotFoundErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias PeerListOrgOpeningsResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: ListOrgOpeningsResponse;
    }
  | PeerReadErrors
  | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

alias PeerGetOrgOpeningResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: GetOrgOpeningResponse;
    }
  | PeerReadErrors
  | Vetchium.Problem.HubOpeningNotFoundErrorResponse;

@route("/mesh/org-openings")
@tag("Tenant-local Org Openings relay")
@useAuth(BearerAuth)
interface OrgOpeningRelayOperations {
  @route("/list")
  @post
  list(@body request: RelayListOrgOpeningsRequest):
    | ListOrgOpeningsResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

  @route("/get")
  @post
  get(@body request: RelayGetOrgOpeningRequest):
    | GetOrgOpeningResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/org-openings")
@tag("Authenticated peer Org Openings read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface OrgOpeningPeerOperations {
  @route("/list")
  @post
  list(@body request: PeerListOrgOpeningsRequest): PeerListOrgOpeningsResult;

  @route("/get")
  @post
  get(@body request: PeerGetOrgOpeningRequest): PeerGetOrgOpeningResult;
}
