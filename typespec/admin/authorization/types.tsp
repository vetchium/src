import "@typespec/openapi";

namespace Vetchium.Admin;

/** Permissions currently recognized by the admin portal. */
enum AdminPermission {
  ViewUsers: "admin:view_users",
  ManageUsers: "admin:manage_users",
  ViewHubSignupDomains: "admin:view_hub_signup_domains",
  ManageHubSignupDomains: "admin:manage_hub_signup_domains",
}

/**
 * An extensible effective-permission identifier returned to clients. Values
 * unknown to an older client must be preserved or ignored, not rejected.
 *
 * `x-vetchium-permission-implications` maps a granted permission to the
 * permissions it confers. A grant is stored directly; the implied permissions
 * are added by the API when it reports effective permissions. Clients that
 * present permissions must apply the same map so an implied permission is
 * shown as held rather than as separately grantable.
 */
@format("vetchium-admin-permission")
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #[
    "admin:view_users",
    "admin:manage_users",
    "admin:view_hub_signup_domains",
    "admin:manage_hub_signup_domains"
  ]
)
@TypeSpec.OpenAPI.extension(
  "x-vetchium-permission-implications",
  #{
    `admin:manage_users`: #["admin:view_users"],
    `admin:manage_hub_signup_domains`: #["admin:view_hub_signup_domains"],
  }
)
scalar AdminPermissionID extends string;

/** Effective authorization available to an admin user. */
model AdminAuthorization {
  /** Effective permissions, including permissions implied by other grants. */
  permissions: AdminPermissionID[];
}
