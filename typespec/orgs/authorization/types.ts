export const Superadmin = "org:superadmin" as const;
export const ManageUsers = "org:manage_users" as const;
export const ManageBilling = "org:manage_billing" as const;

export type OrgPermission =
  | typeof Superadmin
  | typeof ManageUsers
  | typeof ManageBilling;

/** Open identifier: a newer API may return permissions this portal does not
 * define yet. */
export type OrgPermissionID = string;

/**
 * Ordered the way portals present permissions rather than lexically, so a
 * permission and the permissions it implies stay adjacent.
 */
export const orgPermissions: readonly OrgPermission[] = [
  Superadmin,
  ManageUsers,
  ManageBilling,
];

const permissionImplications: Readonly<
  Record<OrgPermission, readonly OrgPermission[]>
> = {
  "org:superadmin": [ManageUsers, ManageBilling],
  "org:manage_users": [],
  "org:manage_billing": [],
};

export function isOrgPermission(
  value: OrgPermissionID,
): value is OrgPermission {
  return orgPermissions.includes(value as OrgPermission);
}

/**
 * Returns the permissions conferred by holding permission. Grants are stored
 * directly and implications are resolved when effective permissions are
 * reported, so a caller must never persist the result as a separate grant.
 */
export function impliedPermissions(
  permission: OrgPermissionID,
): readonly OrgPermission[] {
  return isOrgPermission(permission) ? permissionImplications[permission] : [];
}

export function holds(
  effective: readonly OrgPermissionID[],
  permission: OrgPermission,
): boolean {
  return effective.includes(permission);
}

/**
 * Expands direct grants with everything they imply. Identifiers this contract
 * version does not define are preserved so a newer peer's permissions survive a
 * round trip through an older one.
 */
export function effectivePermissions(
  direct: readonly OrgPermissionID[],
): OrgPermissionID[] {
  const effective = new Set<OrgPermissionID>();
  for (const permission of direct) {
    effective.add(permission);
    for (const implied of impliedPermissions(permission)) {
      effective.add(implied);
    }
  }
  return [...effective].sort();
}

/**
 * Reduces effective permissions to the grants that produce them by dropping
 * every permission another listed permission already implies.
 */
export function directPermissions(
  effective: readonly OrgPermissionID[],
): OrgPermissionID[] {
  const direct = effective.filter(
    (candidate) =>
      !effective.some(
        (other) =>
          other !== candidate &&
          impliedPermissions(other).includes(candidate as OrgPermission),
      ),
  );
  return [...new Set(direct)].sort();
}

/**
 * Accepts only defined permissions without duplicates. Server-side membership
 * is the check that keeps an unknown value out of storage.
 */
export function validatePermissions(
  values: readonly OrgPermissionID[],
): boolean {
  return (
    values.every(isOrgPermission) && new Set(values).size === values.length
  );
}
