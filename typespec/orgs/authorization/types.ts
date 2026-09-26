export const Superadmin = "org:superadmin" as const;

export type OrgPermission = typeof Superadmin;

/** Open identifier: a newer API may return permissions this portal does not
 * define yet. */
export type OrgPermissionID = string;

export const orgPermissions: readonly OrgPermission[] = [Superadmin];

export function holds(
  effective: readonly OrgPermissionID[],
  permission: OrgPermission,
): boolean {
  return effective.includes(permission);
}
