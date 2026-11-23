import type { EmailAddress } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";
import type { PageSize, PaginationKey } from "../../common/pagination.ts";
import { isPageSize, isPaginationKey } from "../../common/pagination.ts";
import {
  isOrgPermission,
  type OrgPermissionID,
  validatePermissions,
} from "../authorization/types.ts";
import { maxBulk } from "./invitations.ts";

export const orgUserStateValues = ["active", "disabled"] as const;
export type OrgUserState = (typeof orgUserStateValues)[number];

export const disabledReasonValues = ["manual"] as const;
export type DisabledReason = (typeof disabledReasonValues)[number];

export const userStateFilterValues = ["active", "disabled-manual"] as const;
export type UserStateFilter = (typeof userStateFilterValues)[number];

export const userSortValues = ["email", "joined"] as const;
export type UserSort = (typeof userSortValues)[number];

export type UserFilterText = string;

/**
 * At least two characters, so one letter never scans a whole Org.
 */
export function isUserFilterText(value: UserFilterText): boolean {
  const length = [...value].length;
  return length >= 2 && length <= 320;
}

export interface ListUsersRequest {
  limit?: PageSize;
  pagination_key?: PaginationKey;
  filter_search?: UserFilterText;
  filter_state?: UserStateFilter;
  filter_permission?: OrgPermissionID;
  filter_no_permissions?: boolean;
  sort_by?: UserSort;
  sort_descending?: boolean;
}

export function validateListUsersRequest(request: ListUsersRequest): string[] {
  const fields: string[] = [];
  if (request.limit !== undefined && !isPageSize(request.limit)) {
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
    !isUserFilterText(request.filter_search)
  ) {
    fields.push("filter_search");
  }
  if (
    request.filter_state !== undefined &&
    !userStateFilterValues.includes(request.filter_state)
  ) {
    fields.push("filter_state");
  }
  if (
    request.filter_permission !== undefined &&
    !isOrgPermission(request.filter_permission)
  ) {
    fields.push("filter_permission");
  }
  if (
    request.sort_by !== undefined &&
    !userSortValues.includes(request.sort_by)
  ) {
    fields.push("sort_by");
  }
  return fields;
}

export interface OrgUserSummary {
  email_address: EmailAddress;
  state: OrgUserState;
  disabled_reason?: DisabledReason;
  /** The direct grants; send these back, not the effective permissions. */
  granted_permissions: OrgPermissionID[];
  effective_permissions: OrgPermissionID[];
  joined_at: string;
  last_login_at?: string;
}

export interface ListUsersResponse {
  users: OrgUserSummary[];
  next_pagination_key?: PaginationKey;
}

export interface PermissionCount {
  permission: OrgPermissionID;
  users: number;
}

export interface UserSummaryResponse {
  seats_in_use: number;
  seat_limit: number;
  active_users: number;
  disabled_manual_users: number;
  active_users_without_permissions: number;
  permission_counts: PermissionCount[];
}

function isDistinctBulk(values: readonly EmailAddress[]): boolean {
  return (
    values.length >= 1 &&
    values.length <= maxBulk &&
    values.every(isEmailAddress) &&
    new Set(values).size === values.length
  );
}

function validateAddress(address: EmailAddress): string[] {
  return isEmailAddress(address) ? [] : ["email_address"];
}

function validateAddresses(addresses: readonly EmailAddress[]): string[] {
  return isDistinctBulk(addresses.map(normalizeEmailAddress))
    ? []
    : ["email_addresses"];
}

export interface DisableUserRequest {
  email_address: EmailAddress;
}

export function validateDisableUserRequest(
  request: DisableUserRequest,
): string[] {
  return validateAddress(request.email_address);
}

export interface EnableUserRequest {
  email_address: EmailAddress;
}

export function validateEnableUserRequest(
  request: EnableUserRequest,
): string[] {
  return validateAddress(request.email_address);
}

export interface BulkDisableUsersRequest {
  email_addresses: EmailAddress[];
}

export function validateBulkDisableUsersRequest(
  request: BulkDisableUsersRequest,
): string[] {
  return validateAddresses(request.email_addresses);
}

export interface BulkEnableUsersRequest {
  email_addresses: EmailAddress[];
}

export function validateBulkEnableUsersRequest(
  request: BulkEnableUsersRequest,
): string[] {
  return validateAddresses(request.email_addresses);
}

export interface SetUserPermissionsRequest {
  email_address: EmailAddress;
  permissions: OrgPermissionID[];
}

export function validateSetUserPermissionsRequest(
  request: SetUserPermissionsRequest,
): string[] {
  const fields = validateAddress(request.email_address);
  if (!validatePermissions(request.permissions)) fields.push("permissions");
  return fields;
}

export interface BulkSetUserPermissionsRequest {
  email_addresses: EmailAddress[];
  permissions: OrgPermissionID[];
}

export function validateBulkSetUserPermissionsRequest(
  request: BulkSetUserPermissionsRequest,
): string[] {
  const fields = validateAddresses(request.email_addresses);
  if (!validatePermissions(request.permissions)) fields.push("permissions");
  return fields;
}

/** The most suggest-org-users answers, and its default. */
export const maxUserSuggestions = 20;

/** Trimmed text matched against users' addresses. */
export type UserSuggestionQuery = string;

export function isUserSuggestionQuery(
  value: string,
): value is UserSuggestionQuery {
  const length = Array.from(value).length;
  return (
    length >= 1 &&
    length <= 100 &&
    value === value.trim() &&
    !value.includes("\u0000")
  );
}

export interface SuggestOrgUsersRequest {
  query?: UserSuggestionQuery;
  /** Defaults to 20. */
  limit?: number;
}

export interface SuggestOrgUsersResponse {
  users: EmailAddress[];
}

export function normalizeSuggestOrgUsersRequest(
  request: SuggestOrgUsersRequest,
): SuggestOrgUsersRequest {
  return request.query === undefined
    ? { ...request }
    : { ...request, query: request.query.trim() };
}

export function validateSuggestOrgUsersRequest(
  request: SuggestOrgUsersRequest,
): string[] {
  const fields: string[] = [];
  if (request.query !== undefined && !isUserSuggestionQuery(request.query))
    fields.push("query");
  if (
    request.limit !== undefined &&
    (!Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > maxUserSuggestions)
  )
    fields.push("limit");
  return fields;
}
