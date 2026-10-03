import "@typespec/openapi";

namespace Vetchium.Orgs;

/** Permissions currently recognized by the Org portal. */
enum OrgPermission {
  Superadmin: "org:superadmin",
  ManageUsers: "org:manage_users",
  ManageBilling: "org:manage_billing",
}

/**
 * An extensible effective-permission identifier returned to clients. Values
 * unknown to an older client must be preserved or ignored, not rejected.
 *
 * `x-vetchium-permission-implications` maps a granted permission to the
 * permissions it confers. A grant is stored directly; the implied permissions
 * are added by the API when it reports effective permissions.
 */
@format("vetchium-org-permission")
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["org:superadmin", "org:manage_users", "org:manage_billing"]
)
@TypeSpec.OpenAPI.extension(
  "x-vetchium-permission-implications",
  #{ `org:superadmin`: #["org:manage_users", "org:manage_billing"] }
)
scalar OrgPermissionID extends string;
