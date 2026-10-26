import "@typespec/http";

import "../../common/authentication.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/global-coordinator/authentication.tsp";
import "../../problem/hub/applications.tsp";
import "../../problem/hub/openings.tsp";
import "../types.tsp";
import "./applications.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Applications;

/**
 * The applicant's live read of their own application. Their DID crosses the
 * mesh; the Org's tenant answers only for an applicant the directory homes at
 * the calling tenant, and otherwise as for an unknown application.
 */
model MeshGetApplicationRequest {
  ...ApplicationReference;
  applicant_did: Vetchium.Hub.HubUserDID;
}

alias MeshGetApplicationResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: MyApplicationDetail;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubApplicationNotFoundErrorResponse
  | Vetchium.Problem.HubOrgUnavailableErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

/** Resolves the Org's domain and reads at its home tenant's peer. */
@route("/mesh/hub-applications")
@tag("Tenant-local Hub applications relay")
@useAuth(BearerAuth)
interface ApplicationRelayOperations {
  @route("/get")
  @post
  get(@body request: MeshGetApplicationRequest):
    | MeshGetApplicationResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/hub-applications")
@tag("Authenticated peer Hub applications read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface ApplicationPeerOperations {
  @route("/get")
  @post
  get(@body request: MeshGetApplicationRequest):
    | MeshGetApplicationResult
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;
}
