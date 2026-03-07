import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ============================================
// Role Management
// ============================================

@doc("Request to assign a role to a user.")
model AssignRoleRequest {
  @doc("UUID of the user to assign the role to")
  target_user_id: string;

  @doc("Role name to assign, e.g. 'admin:manage_users'")
  role_name: string;
}

@doc("Request to remove a role from a user.")
model RemoveRoleRequest {
  @doc("UUID of the user to remove the role from")
  target_user_id: string;

  @doc("Role name to remove, e.g. 'admin:manage_users'")
  role_name: string;
}
