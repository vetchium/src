import type {
  AdminAuthorization,
  AdminPermission,
} from "../authorization/types.ts";
import { isAdminPermission } from "../authorization/types.ts";
import type { AdminUserID } from "../common/types.ts";
import { isAdminUserID } from "../common/types.ts";
import type { State } from "../user/user.ts";
import type { EmailAddress } from "../../common/common.ts";
import type {
  LocalizedDisplayName,
  RegionalLanguageCode,
} from "../../common/localization.ts";
import type { PageSize, PaginationKey } from "../../common/pagination.ts";
import { isPageSize, isPaginationKey } from "../../common/pagination.ts";

export type AdminUserFilterText = string;

export interface ListUsersRequest {
  limit?: PageSize;
  pagination_key?: PaginationKey;
  filter_email_address?: AdminUserFilterText;
  filter_display_name?: AdminUserFilterText;
  filter_state?: State;
  filter_is_superadmin?: boolean;
  filter_permission?: AdminPermission;
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
    request.filter_email_address !== undefined &&
    !isAdminUserFilterText(request.filter_email_address)
  ) {
    fields.push("filter_email_address");
  }
  if (
    request.filter_display_name !== undefined &&
    !isAdminUserFilterText(request.filter_display_name)
  ) {
    fields.push("filter_display_name");
  }
  if (
    request.filter_state !== undefined &&
    request.filter_state !== "active" &&
    request.filter_state !== "disabled"
  ) {
    fields.push("filter_state");
  }
  if (
    request.filter_permission !== undefined &&
    !isAdminPermission(request.filter_permission)
  ) {
    fields.push("filter_permission");
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
  display_names: LocalizedDisplayName[];
  primary_display_name_language: RegionalLanguageCode;
  state: State;
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
