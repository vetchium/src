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

/** Grant one directly assignable permission to a regular admin. */
model GrantPermissionRequest {
  admin_user_id: AdminUserID;
  permission: AdminPermission;
}

/** Revoke one directly assignable permission from a regular admin. */
model RevokePermissionRequest {
  admin_user_id: AdminUserID;
  permission: AdminPermission;
}

/** Promote an admin to superadmin. */
model PromoteToSuperadminRequest {
  admin_user_id: AdminUserID;
}

/** Demote a superadmin to a regular admin with no permissions. */
model DemoteFromSuperadminRequest {
  admin_user_id: AdminUserID;
}

@route("/api/admin")
@tag("Admin authorization management")
interface AuthorizationManagementOperations {
  /**
   * Grant a permission. Granting ManageUsers also establishes ViewUsers.
   * Granting an existing or implicit permission is an idempotent success.
   */
  @route("/grant-permission")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-superadmin-required", true)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[Vetchium.SecurityEffect.GrantAdminPermission]
  )
  grantPermission(@body request: GrantPermissionRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.SuperadminRequiredErrorResponse
    | Vetchium.Problem.AdminUserNotFoundErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Revoke a permission. ManageUsers must be revoked before ViewUsers, and
   * revoking ManageUsers leaves ViewUsers assigned.
   */
  @route("/revoke-permission")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-superadmin-required", true)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[Vetchium.SecurityEffect.RevokeAdminPermission]
  )
  revokePermission(@body request: RevokePermissionRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.SuperadminRequiredErrorResponse
    | Vetchium.Problem.AdminUserNotFoundErrorResponse
    | Vetchium.Problem.PermissionDependencyConflictErrorResponse
    | Vetchium.Problem.PermissionNotApplicableErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Promote an admin using recent superadmin authentication. Direct permission
   * grants and the target's existing sessions are cleared.
   */
  @route("/promote-to-superadmin")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-superadmin-required", true)
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.PromoteToSuperadmin,
      Vetchium.SecurityEffect.ClearDirectPermissions,
      Vetchium.SecurityEffect.RevokeAllSessions,
      Vetchium.SecurityEffect.InvalidateLoginChallenges
    ]
  )
  promoteToSuperadmin(@body request: PromoteToSuperadminRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.SuperadminRequiredErrorResponse
    | Vetchium.Problem.AdminUserNotFoundErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Demote another superadmin using recent authentication. The last active
   * superadmin cannot be demoted, and the target retains no permissions.
   */
  @route("/demote-from-superadmin")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-superadmin-required", true)
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.DemoteFromSuperadmin,
      Vetchium.SecurityEffect.ClearDirectPermissions,
      Vetchium.SecurityEffect.RevokeAllSessions,
      Vetchium.SecurityEffect.InvalidateLoginChallenges
    ]
  )
  demoteFromSuperadmin(@body request: DemoteFromSuperadminRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.SuperadminRequiredErrorResponse
    | Vetchium.Problem.AdminUserNotFoundErrorResponse
    | Vetchium.Problem.CannotDemoteCurrentSuperadminErrorResponse
    | Vetchium.Problem.LastActiveSuperadminErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
