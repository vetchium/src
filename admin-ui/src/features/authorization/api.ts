import type {
  DemoteFromSuperadminRequest,
  GrantPermissionRequest,
  PromoteToSuperadminRequest,
  RevokePermissionRequest,
} from "../../../../typespec/admin/authorization/management.ts";
import { requestVoid } from "../../api/client";

export function grantPermission(
  request: GrantPermissionRequest,
): Promise<void> {
  return requestVoid("/admin/grant-permission", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function revokePermission(
  request: RevokePermissionRequest,
): Promise<void> {
  return requestVoid("/admin/revoke-permission", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function promoteToSuperadmin(
  request: PromoteToSuperadminRequest,
): Promise<void> {
  return requestVoid("/admin/promote-to-superadmin", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function demoteFromSuperadmin(
  request: DemoteFromSuperadminRequest,
): Promise<void> {
  return requestVoid("/admin/demote-from-superadmin", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
