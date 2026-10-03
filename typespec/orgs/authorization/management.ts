import type { OrgPermissionID } from "./types.ts";

/** One catalog permission and what a direct grant of it also confers. */
export interface PermissionDescriptor {
  permission: OrgPermissionID;
  implies: OrgPermissionID[];
}

export interface ListPermissionsResponse {
  permissions: PermissionDescriptor[];
}
