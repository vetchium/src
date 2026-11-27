import type { PaginationKey } from "../../common/pagination.ts";
import { isPaginationKey } from "../../common/pagination.ts";
import { isProfileAddress, type ProfileAddress } from "../profile/public.ts";
import {
  type HubHandle,
  type HubUserDID,
  isHubHandle,
  isHubUserDID,
} from "../types.ts";

export const defaultLimit = 20;
export const maxLimit = 50;

export interface BlockUserRequest {
  user: ProfileAddress;
}

export function normalizeBlockUserRequest(
  request: BlockUserRequest,
): BlockUserRequest {
  return { ...request, user: request.user.trim() };
}

export function validateBlockUserRequest(request: BlockUserRequest): string[] {
  return isProfileAddress(request.user) ? [] : ["user"];
}

function validatePage(
  paginationKey: PaginationKey | undefined,
  limit: number | undefined,
): string[] {
  const fields: string[] = [];
  if (paginationKey !== undefined && !isPaginationKey(paginationKey))
    fields.push("pagination_key");
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > maxLimit)
  )
    fields.push("limit");
  return fields;
}

export interface ListBlockedUsersRequest {
  pagination_key?: PaginationKey;
  limit?: number;
}

export function validateListBlockedUsersRequest(
  request: ListBlockedUsersRequest,
): string[] {
  return validatePage(request.pagination_key, request.limit);
}

export interface BlockedUser {
  handle: HubHandle;
  created_at: string;
}

export interface ListBlockedUsersResponse {
  users: BlockedUser[];
  next_pagination_key?: PaginationKey;
}

export interface ListMutedUsersRequest {
  pagination_key?: PaginationKey;
  limit?: number;
}

export function validateListMutedUsersRequest(
  request: ListMutedUsersRequest,
): string[] {
  return validatePage(request.pagination_key, request.limit);
}

export interface MutedUser {
  handle: HubHandle;
  created_at: string;
}

export interface ListMutedUsersResponse {
  users: MutedUser[];
  next_pagination_key?: PaginationKey;
}

export interface BlockState {
  blocked: boolean;
  muted: boolean;
}

export interface CheckBlockRequest {
  blocker_hub_user_did: HubUserDID;
  blocked_hub_user_did: HubUserDID;
  viewer_handle: HubHandle;
}

export function validateCheckBlockRequest(
  request: CheckBlockRequest,
): string[] {
  const fields: string[] = [];
  if (!isHubUserDID(request.blocker_hub_user_did))
    fields.push("blocker_hub_user_did");
  if (!isHubUserDID(request.blocked_hub_user_did))
    fields.push("blocked_hub_user_did");
  if (!isHubHandle(request.viewer_handle)) fields.push("viewer_handle");
  return fields;
}

export interface CheckBlockResponse {
  blocked: boolean;
}
