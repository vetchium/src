import "@typespec/http";
import "@typespec/openapi";

import "../../common/security-effects.tsp";
import "../../problem/admin/authentication.tsp";
import "../../problem/admin/authorization.tsp";
import "../../problem/admin/users.tsp";
import "../../problem/details.tsp";
import "../types.tsp";
import "./types.tsp";

using TypeSpec.Http;

namespace Vetchium.Admin;

/** Atomically replace an administrator's directly assigned permissions. */
model SetPermissionsRequest {
  admin_user_id: AdminUserID;

  @maxItems(2)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  permissions: AdminPermission[];
}

@route("/api/admin")
@tag("Admin authorization management")
interface AuthorizationManagementOperations {
  /** Replace an admin's permissions. ManageUsers implies ViewUsers. */
  @route("/set-user-permissions")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "admin:manage_users"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[Vetchium.SecurityEffect.ReplaceAdminPermissions]
  )
  setPermissions(@body request: SetPermissionsRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.AdminUserNotFoundErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
