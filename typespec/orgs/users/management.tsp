import "@typespec/http";
import "@typespec/openapi";

import "../../common/common.tsp";
import "../../common/pagination.tsp";
import "../../common/security-effects.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/suspension.tsp";
import "../../problem/orgs/users.tsp";
import "../authorization/types.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs;

enum OrgUserState {
  Active: "active",
  Disabled: "disabled",
}

enum OrgUserDisabledReason {
  Manual: "manual",
  Nonpayment: "nonpayment",
}

enum OrgUserStateFilter {
  Active: "active",
  DisabledManual: "disabled-manual",
  DisabledNonpayment: "disabled-nonpayment",
}

enum OrgUserSort {
  Email: "email",
  Joined: "joined",
}

@minLength(2)
@maxLength(320)
scalar OrgUserFilterText extends string;

/** Filter and continue a stable keyset-ordered member listing. */
model ListUsersRequest {
  /** Defaults to 50. */
  limit?: PageSize = 50;

  /** Signed opaque key bound to the normalized filters, sort, and position. */
  pagination_key?: PaginationKey;

  /** Case-insensitive partial match against the address. */
  filter_search?: OrgUserFilterText;

  filter_state?: OrgUserStateFilter;

  /**
   * Match users holding this permission as a direct grant, the grants that
   * `user-summary` counts. Must be a permission this API version defines.
   */
  filter_permission?: OrgPermissionID;

  /** When true, match only users with no direct grant. */
  filter_no_permissions?: boolean;

  /** Defaults to `email`. */
  sort_by?: OrgUserSort;

  /** Defaults to false. */
  sort_descending?: boolean;
}

model OrgUserSummary {
  email_address: EmailAddress;
  state: OrgUserState;
  disabled_reason?: OrgUserDisabledReason;

  /** The direct grants; send these back, not the effective permissions. */
  granted_permissions: OrgPermissionID[];

  effective_permissions: OrgPermissionID[];
  joined_at: utcDateTime;
  last_login_at?: utcDateTime;
}

model ListUsersResponse {
  /** Always encoded as an array, including when no users matched. */
  users: OrgUserSummary[];

  next_pagination_key?: PaginationKey;
}

model PermissionCount {
  permission: OrgPermissionID;

  /** Active users holding the permission as a direct grant. */
  users: int32;
}

model UserSummaryResponse {
  seats_in_use: int32;

  /** Absent while the Org has no seat cap. */
  seat_limit?: int32;

  active_users: int32;
  disabled_manual_users: int32;
  disabled_nonpayment_users: int32;

  /** Active users with no direct grant. */
  active_users_without_permissions: int32;

  permission_counts: PermissionCount[];
}

model DisableUserRequest {
  email_address: EmailAddress;
}

model EnableUserRequest {
  email_address: EmailAddress;
}

model BulkDisableUsersRequest {
  @minItems(1)
  @maxItems(100)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  email_addresses: EmailAddress[];
}

model BulkEnableUsersRequest {
  @minItems(1)
  @maxItems(100)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  email_addresses: EmailAddress[];
}

/**
 * Atomically replace a user's directly assigned permissions. Every value must
 * be a permission this API version defines.
 */
model SetUserPermissionsRequest {
  email_address: EmailAddress;

  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  permissions: OrgPermissionID[];
}

model BulkSetUserPermissionsRequest {
  @minItems(1)
  @maxItems(100)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  email_addresses: EmailAddress[];

  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  permissions: OrgPermissionID[];
}

@route("/api/orgs")
@tag("Org user management")
interface UserManagementOperations {
  /**
   * List users ordered by address or join date, keyset-paginated over live
   * data. Pending invitations are not users and are excluded.
   */
  @route("/list-users")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["normalized-filters", "sort", "sort-key", "email_address"]
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
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Seat use and member counts per state and per directly granted role. */
  @route("/user-summary")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  userSummary():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: UserSummaryResponse;
      }
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Disable users and end their sessions. Refused when the Org would be left
   * without an active superadmin. Only a superadmin may disable a superadmin.
   */
  @route("/disable-user")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.DisableOrgUser,
      Vetchium.SecurityEffect.RevokeAllSessions
    ]
  )
  disableUser(@body request: DisableUserRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuperadminRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgUserNotFoundErrorResponse
    | Vetchium.Problem.OrgSelfChangeForbiddenErrorResponse
    | Vetchium.Problem.OrgLastSuperadminErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Disable up to 100 users, all or none. */
  @route("/bulk-disable-users")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.DisableOrgUser,
      Vetchium.SecurityEffect.RevokeAllSessions
    ]
  )
  bulkDisableUsers(@body request: BulkDisableUsersRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuperadminRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgUserNotFoundErrorResponse
    | Vetchium.Problem.OrgSelfChangeForbiddenErrorResponse
    | Vetchium.Problem.OrgLastSuperadminErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Re-enable a disabled user, whatever the reason, when a seat is free. Only
   * a superadmin may re-enable a superadmin.
   */
  @route("/enable-user")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[Vetchium.SecurityEffect.EnableOrgUser]
  )
  enableUser(@body request: EnableUserRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuperadminRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgUserNotFoundErrorResponse
    | Vetchium.Problem.OrgUserLimitReachedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Re-enable up to 100 users, all or none, when the batch fits the cap. */
  @route("/bulk-enable-users")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[Vetchium.SecurityEffect.EnableOrgUser]
  )
  bulkEnableUsers(@body request: BulkEnableUsersRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuperadminRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgUserNotFoundErrorResponse
    | Vetchium.Problem.OrgUserLimitReachedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Replace a user's directly assigned permissions. A caller without
   * `org:superadmin` may not grant or revoke `org:superadmin` or
   * `org:manage_billing`. Refused when the Org would be left without an active
   * superadmin.
   */
  @route("/set-user-permissions")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[Vetchium.SecurityEffect.ReplaceOrgPermissions]
  )
  setUserPermissions(@body request: SetUserPermissionsRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuperadminRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgUserNotFoundErrorResponse
    | Vetchium.Problem.OrgSelfChangeForbiddenErrorResponse
    | Vetchium.Problem.OrgLastSuperadminErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Give up to 100 users the same direct grants, all or none. */
  @route("/bulk-set-user-permissions")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[Vetchium.SecurityEffect.ReplaceOrgPermissions]
  )
  bulkSetUserPermissions(@body request: BulkSetUserPermissionsRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuperadminRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgUserNotFoundErrorResponse
    | Vetchium.Problem.OrgSelfChangeForbiddenErrorResponse
    | Vetchium.Problem.OrgLastSuperadminErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
