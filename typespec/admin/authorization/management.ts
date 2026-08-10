import { type AdminUserID, isAdminUserID } from "../types.ts";
import { type AdminPermission, isAdminPermission } from "./types.ts";

export interface GrantPermissionRequest {
  admin_user_id: AdminUserID;
  permission: AdminPermission;
}

export interface RevokePermissionRequest {
  admin_user_id: AdminUserID;
  permission: AdminPermission;
}

export interface PromoteToSuperadminRequest {
  admin_user_id: AdminUserID;
}

export interface DemoteFromSuperadminRequest {
  admin_user_id: AdminUserID;
}

export function validateGrantPermissionRequest(
  request: GrantPermissionRequest,
): string[] {
  return validatePermissionTarget(request.admin_user_id, request.permission);
}

export function validateRevokePermissionRequest(
  request: RevokePermissionRequest,
): string[] {
  return validatePermissionTarget(request.admin_user_id, request.permission);
}

export function validatePromoteToSuperadminRequest(
  request: PromoteToSuperadminRequest,
): string[] {
  return validateTarget(request.admin_user_id);
}

export function validateDemoteFromSuperadminRequest(
  request: DemoteFromSuperadminRequest,
): string[] {
  return validateTarget(request.admin_user_id);
}

function validatePermissionTarget(
  userID: AdminUserID,
  permission: AdminPermission,
): string[] {
  const fields = validateTarget(userID);
  if (!isAdminPermission(permission)) {
    fields.push("permission");
  }
  return fields;
}

function validateTarget(userID: AdminUserID): string[] {
  return isAdminUserID(userID) ? [] : ["admin_user_id"];
}
