import type { DisplayName } from "../../common/localization.ts";
import type { PaginationKey } from "../../common/pagination.ts";
import { isPaginationKey } from "../../common/pagination.ts";
import type { HubAlias } from "../../directory/directory.ts";
import { isProfileAddress, type ProfileAddress } from "../profile/public.ts";
import type { HubHandle } from "../types.ts";
import type { PostEmbed, QuoteTarget } from "./quotes.ts";

export const defaultLimit = 20;
export const maxLimit = 50;
/** The most code points in a post or reply body (PST-GEN-003). */
export const MaxBodyLength = 512;

export type PostID = string;

export type PostKind = "post" | "quote";
export type ReplyPolicy = "everyone" | "nobody";
export type QuotePolicy = "everyone" | "nobody";

export const postKinds: readonly PostKind[] = ["post", "quote"];
export const replyPolicies: readonly ReplyPolicy[] = ["everyone", "nobody"];
export const quotePolicies: readonly QuotePolicy[] = ["everyone", "nobody"];

export function isPostID(value: unknown): value is PostID {
  return typeof value === "string" && /^[0-9a-v]{20}[0-9a-z]{20}$/.test(value);
}

/** Reports trimmed text of 1 to 512 code points without U+0000. */
export function isBody(value: string): boolean {
  const size = [...value].length;
  return (
    size >= 1 &&
    size <= MaxBodyLength &&
    value.trim() === value &&
    !value.includes("\u0000")
  );
}

export function isReplyPolicy(value: unknown): value is ReplyPolicy {
  return value === "everyone" || value === "nobody";
}

export function isQuotePolicy(value: unknown): value is QuotePolicy {
  return value === "everyone" || value === "nobody";
}

export interface PostOwner {
  handle: HubHandle;
  alias?: HubAlias;
  display_name: DisplayName;
  picture_url?: string;
}

// T23 adds quote_target and embed.
/**
 * A post as an embed shows it: no `embed` of its own (PST-QTE-010). A quote
 * inside an embed keeps only `quote_target`.
 */
export interface EmbeddedPost {
  post_id: PostID;
  owner: PostOwner;
  kind: PostKind;
  body: string;
  reply_policy: ReplyPolicy;
  quote_policy: QuotePolicy;
  locked: boolean;
  reply_count: number;
  quote_count: number;
  revision: number;
  edited: boolean;
  created_at: string;
  edited_at?: string;
  /** Set when `kind` is `quote`. */
  quote_target?: QuoteTarget;
}

export interface Post extends EmbeddedPost {
  /** The quote target as read at response time (PST-QTE-009). */
  embed?: PostEmbed;
}

export interface CreatePostRequest {
  body: string;
  reply_policy?: ReplyPolicy;
  quote_policy?: QuotePolicy;
}

export function normalizeCreatePostRequest(
  request: CreatePostRequest,
): CreatePostRequest {
  return { ...request, body: request.body.trim() };
}

export function validateCreatePostRequest(
  request: CreatePostRequest,
): string[] {
  const fields: string[] = [];
  if (!isBody(request.body)) fields.push("body");
  if (
    request.reply_policy !== undefined &&
    !isReplyPolicy(request.reply_policy)
  )
    fields.push("reply_policy");
  if (
    request.quote_policy !== undefined &&
    !isQuotePolicy(request.quote_policy)
  )
    fields.push("quote_policy");
  return fields;
}

export interface EditPostRequest {
  post_id: PostID;
  body: string;
  revision: number;
}

export function normalizeEditPostRequest(
  request: EditPostRequest,
): EditPostRequest {
  return { ...request, body: request.body.trim() };
}

export function validateEditPostRequest(request: EditPostRequest): string[] {
  const fields: string[] = [];
  if (!isPostID(request.post_id)) fields.push("post_id");
  if (!isBody(request.body)) fields.push("body");
  if (!Number.isInteger(request.revision) || request.revision < 1)
    fields.push("revision");
  return fields;
}

export interface RemovePostRequest {
  post_id: PostID;
}

export function validateRemovePostRequest(
  request: RemovePostRequest,
): string[] {
  return isPostID(request.post_id) ? [] : ["post_id"];
}

export interface SetPostPoliciesRequest {
  post_id: PostID;
  reply_policy: ReplyPolicy;
  quote_policy: QuotePolicy;
  locked: boolean;
}

export function validateSetPostPoliciesRequest(
  request: SetPostPoliciesRequest,
): string[] {
  const fields: string[] = [];
  if (!isPostID(request.post_id)) fields.push("post_id");
  if (!isReplyPolicy(request.reply_policy)) fields.push("reply_policy");
  if (!isQuotePolicy(request.quote_policy)) fields.push("quote_policy");
  return fields;
}

/** Reports the invalid fields of a pagination key and limit. */
export function validatePage(
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

export interface ListPostsRequest {
  owner: ProfileAddress;
  pagination_key?: PaginationKey;
  limit?: number;
}

export function normalizeListPostsRequest(
  request: ListPostsRequest,
): ListPostsRequest {
  return { ...request, owner: request.owner.trim() };
}

export function validateListPostsRequest(request: ListPostsRequest): string[] {
  const fields: string[] = [];
  if (!isProfileAddress(request.owner)) fields.push("owner");
  return [...fields, ...validatePage(request.pagination_key, request.limit)];
}

export interface GetPostRequest {
  owner: ProfileAddress;
  post_id: PostID;
}

export function normalizeGetPostRequest(
  request: GetPostRequest,
): GetPostRequest {
  return { ...request, owner: request.owner.trim() };
}

export function validateGetPostRequest(request: GetPostRequest): string[] {
  const fields: string[] = [];
  if (!isProfileAddress(request.owner)) fields.push("owner");
  if (!isPostID(request.post_id)) fields.push("post_id");
  return fields;
}

export interface ListPostsResponse {
  posts: Post[];
  muted: boolean;
  next_pagination_key?: PaginationKey;
}
