import {
  type AdminPermissionID,
  AdminPermissions,
  directPermissions,
  effectivePermissions,
  impliedPermissions,
  isAdminPermission,
} from "typespec/admin/authorization/types";

export interface PermissionRow {
  permission: AdminPermissionID;
  /** Selected in its own right rather than through another permission. */
  selected: boolean;
  /** Selected permissions that already confer this one. */
  impliedBy: AdminPermissionID[];
  /** False for a permission a newer API version added. */
  defined: boolean;
}

/**
 * Rows for every permission this portal knows, followed by any the API reports
 * that it does not. An unknown permission stays visible and editable so a
 * portal older than its API neither hides nor silently revokes access.
 */
export function permissionRows(
  selected: readonly AdminPermissionID[],
): PermissionRow[] {
  const unknown = selected.filter(
    (permission) => !isAdminPermission(permission),
  );
  return [...AdminPermissions, ...unknown.sort()].map((permission) => ({
    permission,
    selected: selected.includes(permission),
    impliedBy: selected.filter(
      (other) => other !== permission && implies(other, permission),
    ),
    defined: isAdminPermission(permission),
  }));
}

export function togglePermission(
  selected: readonly AdminPermissionID[],
  permission: AdminPermissionID,
  granted: boolean,
): AdminPermissionID[] {
  const remaining = selected.filter((value) => value !== permission);
  return granted ? [...remaining, permission] : remaining;
}

/** Grants to send, with permissions another grant already confers removed. */
export function permissionGrants(
  selected: readonly AdminPermissionID[],
): AdminPermissionID[] {
  return directPermissions(selected);
}

export function samePermissions(
  first: readonly AdminPermissionID[],
  second: readonly AdminPermissionID[],
): boolean {
  const left = effectivePermissions(first);
  const right = effectivePermissions(second);
  return (
    left.length === right.length &&
    left.every((permission, index) => permission === right[index])
  );
}

export function permissionNameKey(permission: AdminPermissionID): string {
  return `permissions.${permission}.name`;
}

export function permissionDescriptionKey(
  permission: AdminPermissionID,
): string {
  return `permissions.${permission}.description`;
}

function implies(
  permission: AdminPermissionID,
  candidate: AdminPermissionID,
): boolean {
  return impliedPermissions(permission).some((value) => value === candidate);
}
