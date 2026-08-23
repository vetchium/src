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

/**
 * Atomically replace an administrator's directly assigned permissions. Every
 * value must be a permission this API version defines; the extensible
 * identifier lets a client return permissions it does not itself recognize
 * instead of dropping them.
 */
model SetPermissionsRequest {
  admin_user_id: AdminUserID;

  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  permissions: AdminPermissionID[];
}

@route("/api/admin")
@tag("Admin authorization management")
interface AuthorizationManagementOperations {
  /**
   * Replace an admin's directly assigned permissions. Implied permissions are
   * resolved on read and must not be sent as separate grants. Rejected when
   * the change would leave no active admin holding admin:manage_users.
   */
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
    | Vetchium.Problem.AdminPermissionRequiredErrorResponse
    | Vetchium.Problem.AdminUserNotFoundErrorResponse
    | Vetchium.Problem.LastAdminManagerErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
