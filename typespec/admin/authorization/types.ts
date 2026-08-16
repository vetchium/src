export type AdminPermission = "admin:view_users" | "admin:manage_users";
export type AdminPermissionID = string;

export const ViewUsers: AdminPermission = "admin:view_users";
export const ManageUsers: AdminPermission = "admin:manage_users";

export interface AdminAuthorization {
  permissions: AdminPermissionID[];
}

export function isAdminPermission(value: AdminPermission): boolean {
  return value === ViewUsers || value === ManageUsers;
}

export function validatePermissions(values: AdminPermission[]): boolean {
  return (
    values.every(isAdminPermission) && new Set(values).size === values.length
  );
}
