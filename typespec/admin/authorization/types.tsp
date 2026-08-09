import "@typespec/openapi";

namespace Vetchium.Admin;

/** Permissions currently recognized by the admin portal. */
enum AdminPermission {
  ViewUsers: "admin:view_users",
  ManageUsers: "admin:manage_users",
}

/**
 * An extensible effective-permission identifier returned to clients. Values
 * unknown to an older client must be preserved or ignored, not rejected.
 */
@format("vetchium-admin-permission")
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["admin:view_users", "admin:manage_users"]
)
scalar AdminPermissionID extends string;

/** Effective authorization available to an admin user. */
model AdminAuthorization {
  /** Superadmins implicitly possess every current and future permission. */
  is_superadmin: boolean;

  /** Effective permissions, including permissions implied by other grants. */
  permissions: AdminPermissionID[];
}
