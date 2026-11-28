import { isBody, isPostID, type PostID } from "../hub/posts/posts.ts";
import type { HubHandle, HubUserDID } from "../hub/types.ts";
import { isHubHandle, isHubUserDID } from "../hub/types.ts";
import type { CommandKind } from "./commands.ts";
import type { AggregateType, EventKind } from "./events.ts";

/**
 * The command the replier's home tenant sends to the post owner's tenant to
 * register a reply (PST-RPL-005). Its authority principal is the post owner
 * and its aggregate id is the post ID.
 */
export const HubPostReplyRegisterKind: CommandKind = "hub-post-reply-register";

/** Versions hub-reply-edited and hub-reply-removed by the reply's version. */
export const AggregateHubReply: AggregateType = "hub_reply";

/**
 * Versions hub-post-removed by the post's version and hub-post-quoted and
 * hub-post-unquoted by the quote post's version.
 */
export const AggregateHubPost: AggregateType = "hub_post";

export interface HubPostReplyRegisterPayload {
  post_id: PostID;
  reply_id: PostID;
  parent_reply_id?: PostID;
  replier_hub_user_did: HubUserDID;
  replier_handle: HubHandle;
  body: string;
  created_at: string;
}

export function normalizeHubPostReplyRegisterPayload(
  payload: HubPostReplyRegisterPayload,
): HubPostReplyRegisterPayload {
  return { ...payload, body: payload.body.trim() };
}

function isTimestamp(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function validateHubPostReplyRegisterPayload(
  payload: HubPostReplyRegisterPayload,
): string[] {
  const fields: string[] = [];
  if (!isPostID(payload.post_id)) fields.push("post_id");
  if (!isPostID(payload.reply_id)) fields.push("reply_id");
  if (
    payload.parent_reply_id !== undefined &&
    !isPostID(payload.parent_reply_id)
  )
    fields.push("parent_reply_id");
  if (!isHubUserDID(payload.replier_hub_user_did))
    fields.push("replier_hub_user_did");
  if (!isHubHandle(payload.replier_handle)) fields.push("replier_handle");
  if (!isBody(payload.body)) fields.push("body");
  if (!isTimestamp(payload.created_at)) fields.push("created_at");
  return fields;
}

/** The stored `200` body of a successful hub-post-reply-register. */
export interface HubPostReplyRegisterResult {
  reply_id: PostID;
  created_at: string;
}

/**
 * The event the reply author's tenant enqueues for the post owner's tenant,
 * which updates the reply copy (PST-RPL-010). It shares a watermark with
 * hub-reply-removed.
 */
export const HubReplyEditedKind: EventKind = "hub-reply-edited";

export interface HubReplyEditedPayload {
  post_id: PostID;
  reply_id: PostID;
  body: string;
  revision: number;
  author_hub_user_did: HubUserDID;
}

export function validateHubReplyEditedPayload(
  payload: HubReplyEditedPayload,
): string[] {
  const fields: string[] = [];
  if (!isPostID(payload.post_id)) fields.push("post_id");
  if (!isPostID(payload.reply_id)) fields.push("reply_id");
  if (!isBody(payload.body)) fields.push("body");
  if (!Number.isInteger(payload.revision) || payload.revision < 1)
    fields.push("revision");
  if (!isHubUserDID(payload.author_hub_user_did))
    fields.push("author_hub_user_did");
  return fields;
}

/** The event that clears the reply copy (PST-RPL-011). */
export const HubReplyRemovedKind: EventKind = "hub-reply-removed";

export interface HubReplyRemovedPayload {
  post_id: PostID;
  reply_id: PostID;
  author_hub_user_did: HubUserDID;
}

export function validateHubReplyRemovedPayload(
  payload: HubReplyRemovedPayload,
): string[] {
  const fields: string[] = [];
  if (!isPostID(payload.post_id)) fields.push("post_id");
  if (!isPostID(payload.reply_id)) fields.push("reply_id");
  if (!isHubUserDID(payload.author_hub_user_did))
    fields.push("author_hub_user_did");
  return fields;
}

/**
 * The event the post owner's tenant enqueues for each reply author after a
 * post is removed (PST-RPL-013).
 */
export const HubPostRemovedKind: EventKind = "hub-post-removed";

export interface HubPostRemovedPayload {
  post_id: PostID;
  owner_hub_user_did: HubUserDID;
}

export function validateHubPostRemovedPayload(
  payload: HubPostRemovedPayload,
): string[] {
  const fields: string[] = [];
  if (!isPostID(payload.post_id)) fields.push("post_id");
  if (!isHubUserDID(payload.owner_hub_user_did))
    fields.push("owner_hub_user_did");
  return fields;
}

/**
 * The event the quoter's tenant enqueues for the target post owner's tenant
 * (PST-QTE-005). It shares a watermark with hub-post-unquoted.
 */
export const HubPostQuotedKind: EventKind = "hub-post-quoted";

export interface HubPostQuotedPayload {
  target_post_id: PostID;
  quote_post_id: PostID;
  quoter_hub_user_did: HubUserDID;
  quoter_handle: HubHandle;
  created_at: string;
}

export function validateHubPostQuotedPayload(
  payload: HubPostQuotedPayload,
): string[] {
  const fields: string[] = [];
  if (!isPostID(payload.target_post_id)) fields.push("target_post_id");
  if (!isPostID(payload.quote_post_id)) fields.push("quote_post_id");
  if (!isHubUserDID(payload.quoter_hub_user_did))
    fields.push("quoter_hub_user_did");
  if (!isHubHandle(payload.quoter_handle)) fields.push("quoter_handle");
  if (!isTimestamp(payload.created_at)) fields.push("created_at");
  return fields;
}

/** The event the quoter's tenant enqueues after a quote post is removed. */
export const HubPostUnquotedKind: EventKind = "hub-post-unquoted";

export interface HubPostUnquotedPayload {
  target_post_id: PostID;
  quote_post_id: PostID;
  quoter_hub_user_did: HubUserDID;
}

export function validateHubPostUnquotedPayload(
  payload: HubPostUnquotedPayload,
): string[] {
  const fields: string[] = [];
  if (!isPostID(payload.target_post_id)) fields.push("target_post_id");
  if (!isPostID(payload.quote_post_id)) fields.push("quote_post_id");
  if (!isHubUserDID(payload.quoter_hub_user_did))
    fields.push("quoter_hub_user_did");
  return fields;
}
