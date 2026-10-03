import "@typespec/http";
import "@typespec/openapi";

import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "./types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs;

/** One permission the database accepts, and what holding it also confers. */
model PermissionDescriptor {
  permission: OrgPermissionID;

  /** Permissions conferred by a direct grant of this one. */
  implies: OrgPermissionID[];
}

model ListPermissionsResponse {
  permissions: PermissionDescriptor[];
}

@route("/api/orgs")
@tag("Org authorization")
interface AuthorizationOperations {
  /**
   * The permission catalog, so a portal presents every permission the API
   * accepts, including ones it cannot name.
   */
  @route("/list-permissions")
  @get
  @useAuth(BearerAuth)
  listPermissions():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListPermissionsResponse;
      }
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
