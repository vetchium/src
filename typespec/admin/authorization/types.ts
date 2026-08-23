export type AdminPermission =
  | "admin:view_users"
  | "admin:manage_users"
  | "admin:view_hub_signup_domains"
  | "admin:manage_hub_signup_domains";
export type AdminPermissionID = string;

export const ViewUsers: AdminPermission = "admin:view_users";
export const ManageUsers: AdminPermission = "admin:manage_users";
export const ViewHubSignupDomains: AdminPermission =
  "admin:view_hub_signup_domains";
export const ManageHubSignupDomains: AdminPermission =
  "admin:manage_hub_signup_domains";

/**
 * Ordered the way portals present permissions rather than lexically, so a
 * permission and the permissions it implies stay adjacent.
 */
export const AdminPermissions: readonly AdminPermission[] = [
  ViewUsers,
  ManageUsers,
  ViewHubSignupDomains,
  ManageHubSignupDomains,
];

const permissionImplications: Readonly<
  Record<AdminPermission, readonly AdminPermission[]>
> = {
  "admin:view_users": [],
  "admin:manage_users": [ViewUsers],
  "admin:view_hub_signup_domains": [],
  "admin:manage_hub_signup_domains": [ViewHubSignupDomains],
};

export interface AdminAuthorization {
  permissions: AdminPermissionID[];
}

export function isAdminPermission(
  value: AdminPermissionID,
): value is AdminPermission {
  return AdminPermissions.includes(value as AdminPermission);
}

/**
 * Returns the permissions conferred by holding permission. Grants are stored
 * directly and implications are resolved when effective permissions are
 * reported, so a caller must never persist the result as a separate grant.
 */
export function impliedPermissions(
  permission: AdminPermissionID,
): readonly AdminPermission[] {
  return isAdminPermission(permission)
    ? permissionImplications[permission]
    : [];
}

/**
 * Expands direct grants with everything they imply. Identifiers this contract
 * version does not define are preserved so a newer peer's permissions survive a
 * round trip through an older one.
 */
export function effectivePermissions(
  direct: readonly AdminPermissionID[],
): AdminPermissionID[] {
  const effective = new Set<AdminPermissionID>();
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
  effective: readonly AdminPermissionID[],
): AdminPermissionID[] {
  const direct = effective.filter(
    (candidate) =>
      !effective.some(
        (other) =>
          other !== candidate &&
          impliedPermissions(other).includes(candidate as AdminPermission),
      ),
  );
  return [...new Set(direct)].sort();
}

/**
 * Accepts only defined permissions without duplicates. Requests carry the
 * extensible identifier so a client can return permissions it does not
 * recognize, which makes server-side membership the check that keeps an unknown
 * value out of storage.
 */
export function validatePermissions(
  values: readonly AdminPermissionID[],
): boolean {
  return (
    values.every(isAdminPermission) && new Set(values).size === values.length
  );
}
