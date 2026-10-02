import {
  directPermissions,
  effectivePermissions,
  impliedPermissions,
  isOrgPermission,
  ManageBilling,
  ManageUsers,
  type OrgPermissionID,
  orgPermissions,
  Superadmin,
} from "typespec/orgs/authorization/types";

/**
 * A preset only pre-ticks permissions. The grants stay the stored truth; the
 * role shown for a user is derived from them and never stored.
 */
export type RolePreset = "superadmin" | "finance" | "userManager" | "member";

export const rolePresets: ReadonlyArray<{
  preset: RolePreset;
  grants: readonly OrgPermissionID[];
}> = [
  { preset: "superadmin", grants: [Superadmin] },
  { preset: "finance", grants: [ManageBilling] },
  { preset: "userManager", grants: [ManageUsers] },
  { preset: "member", grants: [] },
];

export type Role = RolePreset | "custom";

function sameGrants(
  first: readonly OrgPermissionID[],
  second: readonly OrgPermissionID[],
): boolean {
  const left = [...directPermissions(first)];
  const right = [...directPermissions(second)];
  return (
    left.length === right.length &&
    left.every((permission, index) => permission === right[index])
  );
}

/** The preset the direct grants exactly match, else custom. */
export function roleOf(granted: readonly OrgPermissionID[]): Role {
  return (
    rolePresets.find(({ grants }) => sameGrants(granted, grants))?.preset ??
    "custom"
  );
}

export function presetGrants(preset: RolePreset): OrgPermissionID[] {
  return [
    ...(rolePresets.find((entry) => entry.preset === preset)?.grants ?? []),
  ];
}

/** Only a superadmin hands out these; the API enforces it, this only hides
 * what it would refuse. */
const reserved: readonly OrgPermissionID[] = [Superadmin, ManageBilling];

export function mayGrant(
  viewer: readonly OrgPermissionID[],
  grants: readonly OrgPermissionID[],
): boolean {
  if (viewer.includes(Superadmin)) return true;
  return !effectivePermissions(grants).some((permission) =>
    reserved.includes(permission),
  );
}

/** Whether the viewer may change a user holding these grants: revoking a
 * reserved grant is as restricted as granting one. */
export function mayChange(
  viewer: readonly OrgPermissionID[],
  held: readonly OrgPermissionID[],
  next: readonly OrgPermissionID[],
): boolean {
  const changed = [
    ...held.filter((permission) => !next.includes(permission)),
    ...next.filter((permission) => !held.includes(permission)),
  ];
  return mayGrant(viewer, changed);
}

export interface PermissionRow {
  permission: OrgPermissionID;
  /** Selected in its own right rather than through another permission. */
  selected: boolean;
  /** Selected permissions that already confer this one. */
  impliedBy: OrgPermissionID[];
  /** False for a permission a newer API version added. */
  defined: boolean;
}

/**
 * Rows for every permission this portal knows, followed by any the user holds
 * that it does not. An unknown permission stays visible and editable so a
 * portal older than its API neither hides nor silently revokes access.
 */
export function permissionRows(
  selected: readonly OrgPermissionID[],
): PermissionRow[] {
  const unknown = selected.filter((permission) => !isOrgPermission(permission));
  return [...orgPermissions, ...unknown.sort()].map((permission) => ({
    permission,
    selected: selected.includes(permission),
    impliedBy: selected.filter(
      (other) =>
        other !== permission &&
        impliedPermissions(other).some((value) => value === permission),
    ),
    defined: isOrgPermission(permission),
  }));
}

export function togglePermission(
  selected: readonly OrgPermissionID[],
  permission: OrgPermissionID,
  granted: boolean,
): OrgPermissionID[] {
  const remaining = selected.filter((value) => value !== permission);
  return granted ? [...remaining, permission] : remaining;
}

export function permissionNameKey(permission: OrgPermissionID): string {
  return `permissions.${permission}.name`;
}

export function permissionDescriptionKey(permission: OrgPermissionID): string {
  return `permissions.${permission}.description`;
}
