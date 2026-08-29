import type { EmailAddress } from "../../common/common.ts";
import type { DisplayName } from "../../common/localization.ts";
import type { PageSize, PaginationKey } from "../../common/pagination.ts";
import { isPageSize, isPaginationKey } from "../../common/pagination.ts";
import type {
  AdminAuthorization,
  AdminPermissionID,
} from "../authorization/types.ts";
import { validatePermissions } from "../authorization/types.ts";
import type { AdminUserID } from "../types.ts";
import { isAdminUserID } from "../types.ts";
import type { AdminUserState } from "./state.ts";

export type AdminUserFilterText = string;
export type AdminLastLoginFilter =
  | "never"
  | "inactive_30_days"
  | "inactive_90_days";

export interface ListUsersRequest {
  limit?: PageSize;
  pagination_key?: PaginationKey;
  filter_search?: AdminUserFilterText;
  filter_state?: AdminUserState;
  filter_permissions?: AdminPermissionID[];
  filter_no_permissions?: boolean;
  filter_totp_enabled?: boolean;
  filter_last_login?: AdminLastLoginFilter;
}

export function effectiveListUsersLimit(request: ListUsersRequest): PageSize {
  return request.limit ?? 50;
}

export function validateListUsersRequest(request: ListUsersRequest): string[] {
  const fields: string[] = [];
  if (!isPageSize(effectiveListUsersLimit(request))) {
    fields.push("limit");
  }
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  ) {
    fields.push("pagination_key");
  }
  if (
    request.filter_search !== undefined &&
    !isAdminUserFilterText(request.filter_search)
  ) {
    fields.push("filter_search");
  }
  if (
    request.filter_state !== undefined &&
    request.filter_state !== "active" &&
    request.filter_state !== "disabled"
  ) {
    fields.push("filter_state");
  }
  if (
    request.filter_permissions !== undefined &&
    !validatePermissions(request.filter_permissions)
  ) {
    fields.push("filter_permissions");
  }
  if (
    request.filter_last_login !== undefined &&
    request.filter_last_login !== "never" &&
    request.filter_last_login !== "inactive_30_days" &&
    request.filter_last_login !== "inactive_90_days"
  ) {
    fields.push("filter_last_login");
  }
  return fields;
}

function isAdminUserFilterText(value: AdminUserFilterText): boolean {
  const length = [...value].length;
  return length >= 1 && length <= 320;
}

export interface AdminUserSummary extends AdminAuthorization {
  admin_user_id: AdminUserID;
  email_address: EmailAddress;
  display_name: DisplayName;
  state: AdminUserState;
  totp_enabled: boolean;
  last_login_at?: string;
  created_at: string;
}

export interface ListUsersResponse {
  users: AdminUserSummary[];
  next_pagination_key?: PaginationKey;
}

export interface DisableUserRequest {
  admin_user_id: AdminUserID;
}

export function validateDisableUserRequest(
  request: DisableUserRequest,
): string[] {
  return isAdminUserID(request.admin_user_id) ? [] : ["admin_user_id"];
}

export interface EnableUserRequest {
  admin_user_id: AdminUserID;
}

export function validateEnableUserRequest(
  request: EnableUserRequest,
): string[] {
  return isAdminUserID(request.admin_user_id) ? [] : ["admin_user_id"];
}
