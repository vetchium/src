import type { PaginationKey } from "../../common/pagination.ts";
import { isProfileAddress, type ProfileAddress } from "../profile/public.ts";
import type { HubHandle } from "../types.ts";
import { isBody, isPostID, type PostID, validatePage } from "./posts.ts";

export type ThreadReplyState = "live" | "hidden" | "placeholder";

export const threadReplyStates: readonly ThreadReplyState[] = [
  "live",
  "hidden",
  "placeholder",
];

export function isThreadReplyState(value: unknown): value is ThreadReplyState {
  return threadReplyStates.includes(value as ThreadReplyState);
}

export interface Reply {
  reply_id: PostID;
  post_id: PostID;
  parent_reply_id?: PostID;
  author_handle: HubHandle;
  /** Absent for a placeholder. */
  body?: string;
  state: ThreadReplyState;
  child_count: number;
  revision: number;
  edited: boolean;
  created_at: string;
}

/** The `Idempotency-Key` header travels beside this body. */
export interface ReplyRequest {
  owner: ProfileAddress;
  post_id: PostID;
  parent_reply_id?: PostID;
  body: string;
}

export function normalizeReplyRequest(request: ReplyRequest): ReplyRequest {
  return {
    ...request,
    owner: request.owner.trim(),
    body: request.body.trim(),
  };
}

export function validateReplyRequest(request: ReplyRequest): string[] {
  const fields: string[] = [];
  if (!isProfileAddress(request.owner)) fields.push("owner");
  if (!isPostID(request.post_id)) fields.push("post_id");
  if (
    request.parent_reply_id !== undefined &&
    !isPostID(request.parent_reply_id)
  )
    fields.push("parent_reply_id");
  if (!isBody(request.body)) fields.push("body");
  return fields;
}

export interface EditReplyRequest {
  reply_id: PostID;
  body: string;
  revision: number;
}

export function normalizeEditReplyRequest(
  request: EditReplyRequest,
): EditReplyRequest {
  return { ...request, body: request.body.trim() };
}

export function validateEditReplyRequest(request: EditReplyRequest): string[] {
  const fields: string[] = [];
  if (!isPostID(request.reply_id)) fields.push("reply_id");
  if (!isBody(request.body)) fields.push("body");
  if (!Number.isInteger(request.revision) || request.revision < 1)
    fields.push("revision");
  return fields;
}

export interface RemoveReplyRequest {
  reply_id: PostID;
}

export function validateRemoveReplyRequest(
  request: RemoveReplyRequest,
): string[] {
  return isPostID(request.reply_id) ? [] : ["reply_id"];
}

/** The body of `/hide-reply` and `/unhide-reply`. */
export interface HideReplyRequest {
  post_id: PostID;
  reply_id: PostID;
}

export function validateHideReplyRequest(request: HideReplyRequest): string[] {
  const fields: string[] = [];
  if (!isPostID(request.post_id)) fields.push("post_id");
  if (!isPostID(request.reply_id)) fields.push("reply_id");
  return fields;
}

export interface ListRepliesRequest {
  owner: ProfileAddress;
  post_id: PostID;
  parent_reply_id?: PostID;
  /** Starts the page at this reply of the list (PST-THR-009). */
  from_reply_id?: PostID;
  pagination_key?: PaginationKey;
  limit?: number;
}

export function normalizeListRepliesRequest(
  request: ListRepliesRequest,
): ListRepliesRequest {
  return { ...request, owner: request.owner.trim() };
}

export function validateListRepliesRequest(
  request: ListRepliesRequest,
): string[] {
  const fields: string[] = [];
  if (!isProfileAddress(request.owner)) fields.push("owner");
  if (!isPostID(request.post_id)) fields.push("post_id");
  if (
    request.parent_reply_id !== undefined &&
    !isPostID(request.parent_reply_id)
  )
    fields.push("parent_reply_id");
  return [
    ...fields,
    ...validateFrom(request.from_reply_id, request.pagination_key),
    ...validatePage(request.pagination_key, request.limit),
  ];
}

/** A page starts at a reply or after a key, never both. */
export function validateFrom(
  from: PostID | undefined,
  key: PaginationKey | undefined,
): string[] {
  return from !== undefined && (!isPostID(from) || key !== undefined)
    ? ["from_reply_id"]
    : [];
}

export interface ListRepliesResponse {
  replies: Reply[];
  next_pagination_key?: PaginationKey;
}

export type AuthorReplyState = "live" | "post_removed";

export const authorReplyStates: readonly AuthorReplyState[] = [
  "live",
  "post_removed",
];

export function isAuthorReplyState(value: unknown): value is AuthorReplyState {
  return value === "live" || value === "post_removed";
}

/** A reply as the Replies tab shows it. It never holds post words. */
export interface AuthorReply {
  reply_id: PostID;
  post_id: PostID;
  post_owner_handle: HubHandle;
  /** Absent when `state` is `post_removed`. */
  body?: string;
  state: AuthorReplyState;
  edited: boolean;
  created_at: string;
}

/** Names one reply of one post, for a reply link (PST-THR-009). */
export interface LocateReplyRequest {
  owner: ProfileAddress;
  post_id: PostID;
  reply_id: PostID;
}

export function normalizeLocateReplyRequest(
  request: LocateReplyRequest,
): LocateReplyRequest {
  return { ...request, owner: request.owner.trim() };
}

export function validateLocateReplyRequest(
  request: LocateReplyRequest,
): string[] {
  const fields: string[] = [];
  if (!isProfileAddress(request.owner)) fields.push("owner");
  if (!isPostID(request.post_id)) fields.push("post_id");
  if (!isPostID(request.reply_id)) fields.push("reply_id");
  return fields;
}

export interface LocateReplyResponse {
  reply_id: PostID;
  parent_reply_id?: PostID;
}

export interface ListAuthorRepliesRequest {
  owner: ProfileAddress;
  pagination_key?: PaginationKey;
  limit?: number;
}

export function normalizeListAuthorRepliesRequest(
  request: ListAuthorRepliesRequest,
): ListAuthorRepliesRequest {
  return { ...request, owner: request.owner.trim() };
}

export function validateListAuthorRepliesRequest(
  request: ListAuthorRepliesRequest,
): string[] {
  const fields: string[] = [];
  if (!isProfileAddress(request.owner)) fields.push("owner");
  return [...fields, ...validatePage(request.pagination_key, request.limit)];
}

export interface ListAuthorRepliesResponse {
  replies: AuthorReply[];
  muted: boolean;
  next_pagination_key?: PaginationKey;
}
