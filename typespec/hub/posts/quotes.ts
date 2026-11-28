import type { PaginationKey } from "../../common/pagination.ts";
import {
  isOrgDomain,
  normalizeOrgDomain,
  type OrgDomain,
} from "../../orgs/types.ts";
import type {
  OpeningNumber,
  PublicOpeningSummary,
  PublicOrg,
} from "../openings/public.ts";
import { isProfileAddress, type ProfileAddress } from "../profile/public.ts";
import {
  type EmbeddedPost,
  isBody,
  isPostID,
  isQuotePolicy,
  isReplyPolicy,
  type Post,
  type PostID,
  type QuotePolicy,
  type ReplyPolicy,
  validatePage,
} from "./posts.ts";

export type QuoteTargetType = "timeline_post" | "opening";

export const quoteTargetTypes: readonly QuoteTargetType[] = [
  "timeline_post",
  "opening",
];

export function isQuoteTargetType(value: unknown): value is QuoteTargetType {
  return quoteTargetTypes.includes(value as QuoteTargetType);
}

/**
 * Discriminated on `type`. A quote of a reply is not allowed. In a response
 * the `owner` of a timeline target is the permanent handle.
 */
export type QuoteTarget =
  | { type: "timeline_post"; owner: ProfileAddress; post_id: PostID }
  | { type: "opening"; org_domain: OrgDomain; opening_number: OpeningNumber };

export function normalizeQuoteTarget(target: QuoteTarget): QuoteTarget {
  if (target.type === "timeline_post" && typeof target.owner === "string") {
    return { ...target, owner: target.owner.trim() };
  }
  if (target.type === "opening" && typeof target.org_domain === "string") {
    return { ...target, org_domain: normalizeOrgDomain(target.org_domain) };
  }
  return target;
}

/** Accepts a target only when its type is known and it has exactly its own
 * fields, as the Go companion does. */
export function isQuoteTarget(value: unknown): value is QuoteTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  const keys = Object.keys(target).sort().join(",");
  if (target.type === "timeline_post") {
    return (
      keys === "owner,post_id,type" &&
      typeof target.owner === "string" &&
      isProfileAddress(target.owner) &&
      isPostID(target.post_id)
    );
  }
  if (target.type === "opening") {
    return (
      keys === "opening_number,org_domain,type" &&
      typeof target.org_domain === "string" &&
      isOrgDomain(target.org_domain) &&
      Number.isInteger(target.opening_number) &&
      (target.opening_number as number) >= 1
    );
  }
  return false;
}

export interface EmbeddedOpening {
  org: PublicOrg;
  opening: PublicOpeningSummary;
}

/** Discriminated on `state`. */
export type PostEmbed =
  | { state: "post"; post: EmbeddedPost }
  | { state: "opening"; opening: EmbeddedOpening }
  | { state: "unavailable" };

export interface CreateQuoteRequest {
  target: QuoteTarget;
  body: string;
  reply_policy?: ReplyPolicy;
  quote_policy?: QuotePolicy;
}

export function normalizeCreateQuoteRequest(
  request: CreateQuoteRequest,
): CreateQuoteRequest {
  return {
    ...request,
    target: normalizeQuoteTarget(request.target),
    body: request.body.trim(),
  };
}

export function validateCreateQuoteRequest(
  request: CreateQuoteRequest,
): string[] {
  const fields: string[] = [];
  if (!isQuoteTarget(request.target)) fields.push("target");
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

export interface ListQuotesRequest {
  owner: ProfileAddress;
  post_id: PostID;
  pagination_key?: PaginationKey;
  limit?: number;
}

export function normalizeListQuotesRequest(
  request: ListQuotesRequest,
): ListQuotesRequest {
  return { ...request, owner: request.owner.trim() };
}

export function validateListQuotesRequest(
  request: ListQuotesRequest,
): string[] {
  const fields: string[] = [];
  if (!isProfileAddress(request.owner)) fields.push("owner");
  if (!isPostID(request.post_id)) fields.push("post_id");
  return [...fields, ...validatePage(request.pagination_key, request.limit)];
}

export interface ListQuotesResponse {
  posts: Post[];
  /** A region did not answer, so the page can miss quotes. */
  partial: boolean;
  next_pagination_key?: PaginationKey;
}

export interface DetachQuoteRequest {
  post_id: PostID;
  quoter: ProfileAddress;
  quote_post_id: PostID;
}

export function normalizeDetachQuoteRequest(
  request: DetachQuoteRequest,
): DetachQuoteRequest {
  return { ...request, quoter: request.quoter.trim() };
}

export function validateDetachQuoteRequest(
  request: DetachQuoteRequest,
): string[] {
  const fields: string[] = [];
  if (!isPostID(request.post_id)) fields.push("post_id");
  if (!isProfileAddress(request.quoter)) fields.push("quoter");
  if (!isPostID(request.quote_post_id)) fields.push("quote_post_id");
  return fields;
}
