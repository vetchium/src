import "@typespec/openapi";

namespace Vetchium.Orgs;

/** Permissions currently recognized by the Org portal. */
enum OrgPermission {
  Superadmin: "org:superadmin",
}

/**
 * An extensible effective-permission identifier returned to clients. Values
 * unknown to an older client must be preserved or ignored, not rejected.
 */
@format("vetchium-org-permission")
@TypeSpec.OpenAPI.extension("x-vetchium-known-values", #["org:superadmin"])
@TypeSpec.OpenAPI.extension("x-vetchium-permission-implications", #{})
scalar OrgPermissionID extends string;
