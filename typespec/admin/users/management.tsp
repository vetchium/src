import "@typespec/http";
import "@typespec/openapi";

import "../../common/common.tsp";
import "../../common/localization.tsp";
import "../../common/pagination.tsp";
import "../../common/security-effects.tsp";
import "../../problem/admin/authentication.tsp";
import "../../problem/admin/authorization.tsp";
import "../../problem/admin/users.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../authorization/types.tsp";
import "../types.tsp";
import "../user/user.tsp";

using TypeSpec.Http;

namespace Vetchium.Admin;

/** Bounded text used by case-insensitive admin-user filters. */
@minLength(1)
@maxLength(320)
scalar AdminUserFilterText extends string;

/** Useful administrator-account activity windows. */
enum AdminLastLoginFilter {
  Never: "never",
  Inactive30Days: "inactive_30_days",
  Inactive90Days: "inactive_90_days",
}

/** Filter and continue a stable keyset-ordered admin-user listing. */
model ListUsersRequest {
  /** Defaults to 50. */
  limit?: PageSize = 50;

  /** Signed opaque key bound to normalized filters and the stable ordering. */
  pagination_key?: PaginationKey;

  /** Case-insensitive partial match against email or any display name. */
  filter_search?: AdminUserFilterText;

  filter_state?: Vetchium.Admin.User.State;

  /**
   * Match admins whose effective permissions include every listed permission.
   * Every value must be a permission this API version defines.
   */
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  filter_permissions?: AdminPermissionID[];

  /** When true, match only admins holding no permission at all. */
  filter_no_permissions?: boolean;

  filter_totp_enabled?: boolean;
  filter_last_login?: AdminLastLoginFilter;
}

/** Admin-user data required by user-management screens. */
model AdminUserSummary {
  admin_user_id: AdminUserID;
  email_address: EmailAddress;

  @minItems(1)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-by", "language_code")
  display_names: LocalizedDisplayName[];

  primary_display_name_language: RegionalLanguageCode;
  state: Vetchium.Admin.User.State;
  ...AdminAuthorization;
  totp_enabled: boolean;
  last_login_at?: utcDateTime;
  created_at: utcDateTime;
}

/** One page from the stable admin-user keyset ordering. */
model ListUsersResponse {
  /** Always encoded as an array, including when no users matched. */
  users: AdminUserSummary[];

  /** Absent when no subsequent page exists. */
  next_pagination_key?: PaginationKey;
}

/** Target an admin user for disablement. */
model DisableUserRequest {
  admin_user_id: AdminUserID;
}

/** Target an admin user for enablement. */
model EnableUserRequest {
  admin_user_id: AdminUserID;
}

@route("/api/admin")
@tag("Admin user management")
interface UserManagementOperations {
  /**
   * List active and disabled admins using created_at DESC, admin_user_id DESC
   * keyset ordering over live data. Concurrent mutations may affect later
   * pages. Pending invitations are not users and are excluded.
   */
  @route("/list-users")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "admin:view_users"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["normalized-filters", "created_at", "admin_user_id"]
  )
  listUsers(@body request: ListUsersRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListUsersResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.AdminPermissionRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Disable an admin and immediately revoke authentication credentials.
   * Refused when it would leave no active admin holding admin:manage_users.
   * A caller of this operation holds that permission and cannot target
   * themselves, so the refusal guards state reached outside this API rather
   * than an ordinary request, and Playwright cannot provoke it.
   */
  @route("/disable-user")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "admin:manage_users"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.DisableAdminUser,
      Vetchium.SecurityEffect.RevokeAllSessions,
      Vetchium.SecurityEffect.InvalidateLoginChallenges,
      Vetchium.SecurityEffect.InvalidatePasswordResetTokens,
      Vetchium.SecurityEffect.InvalidateTOTPEnrollments
    ]
  )
  disableUser(@body request: DisableUserRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.AdminPermissionRequiredErrorResponse
    | Vetchium.Problem.AdminUserNotFoundErrorResponse
    | Vetchium.Problem.CannotDisableCurrentAdminErrorResponse
    | Vetchium.Problem.LastAdminManagerErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Enable an admin without restoring previously revoked sessions. */
  @route("/enable-user")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "admin:manage_users"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[Vetchium.SecurityEffect.EnableAdminUser]
  )
  enableUser(@body request: EnableUserRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.AdminPermissionRequiredErrorResponse
    | Vetchium.Problem.AdminUserNotFoundErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
