import { type AdminUserID, isAdminUserID } from "../types.ts";
import { type AdminPermission, validatePermissions } from "./types.ts";

export interface SetPermissionsRequest {
  admin_user_id: AdminUserID;
  permissions: AdminPermission[];
}

export function validateSetPermissionsRequest(
  request: SetPermissionsRequest,
): string[] {
  const fields: string[] = [];
  if (!isAdminUserID(request.admin_user_id)) {
    fields.push("admin_user_id");
  }
  if (!validatePermissions(request.permissions)) {
    fields.push("permissions");
  }
  return fields;
}
