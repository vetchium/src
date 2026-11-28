import type { PaginationKey } from "../../common/pagination.ts";
import type { TenantID } from "../../directory/directory.ts";
import {
  type HubHandle,
  type HubUserDID,
  isHubHandle,
  isHubUserDID,
} from "../types.ts";
import { isPostID, type Post, type PostID, validatePage } from "./posts.ts";
import type { AuthorReply, Reply, ThreadReplyState } from "./replies.ts";

export const maxGetMany = 50;

export interface MeshPost extends Post {
  owner_hub_user_did: HubUserDID;
}

export interface MeshListPostsRequest {
  owner_hub_user_did: HubUserDID;
  viewer_hub_user_did: HubUserDID;
  viewer_handle: HubHandle;
  pagination_key?: PaginationKey;
  limit?: number;
}

export function validateMeshListPostsRequest(
  request: MeshListPostsRequest,
): string[] {
  const fields: string[] = [];
  if (!isHubUserDID(request.owner_hub_user_did))
    fields.push("owner_hub_user_did");
  if (!isHubUserDID(request.viewer_hub_user_did))
    fields.push("viewer_hub_user_did");
  if (!isHubHandle(request.viewer_handle)) fields.push("viewer_handle");
  return [...fields, ...validatePage(request.pagination_key, request.limit)];
}

export interface MeshListPostsResponse {
  posts: MeshPost[];
  next_pagination_key?: PaginationKey;
}

export interface MeshPostReference {
  owner_hub_user_did: HubUserDID;
  post_id: PostID;
}

export interface MeshGetManyPostsRequest {
  viewer_hub_user_did: HubUserDID;
  viewer_handle: HubHandle;
  posts: MeshPostReference[];
}

export function validateMeshGetManyPostsRequest(
  request: MeshGetManyPostsRequest,
): string[] {
  const fields: string[] = [];
  if (!isHubUserDID(request.viewer_hub_user_did))
    fields.push("viewer_hub_user_did");
  if (!isHubHandle(request.viewer_handle)) fields.push("viewer_handle");
  const valid =
    request.posts.length >= 1 &&
    request.posts.length <= maxGetMany &&
    request.posts.every(
      (reference) =>
        isHubUserDID(reference.owner_hub_user_did) &&
        isPostID(reference.post_id),
    );
  if (!valid) fields.push("posts");
  return fields;
}

export interface MeshPostFound {
  status: "found";
  owner_hub_user_did: HubUserDID;
  post_id: PostID;
  post: MeshPost;
}

export interface MeshPostNotFound {
  status: "not-found";
  owner_hub_user_did: HubUserDID;
  post_id: PostID;
}

/** The serving tenant does not home the owner. */
export interface MeshPostNotHomed {
  status: "not-homed";
  owner_hub_user_did: HubUserDID;
  post_id: PostID;
}

export type MeshPostResult =
  | MeshPostFound
  | MeshPostNotFound
  | MeshPostNotHomed;

export interface MeshGetManyPostsResponse {
  results: MeshPostResult[];
}

export interface MeshReply extends Reply {
  author_hub_user_did: HubUserDID;
}

function validateViewer(did: string, handle: string): string[] {
  const fields: string[] = [];
  if (!isHubUserDID(did)) fields.push("viewer_hub_user_did");
  if (!isHubHandle(handle)) fields.push("viewer_handle");
  return fields;
}

export interface MeshListRepliesRequest {
  owner_hub_user_did: HubUserDID;
  post_id: PostID;
  parent_reply_id?: PostID;
  viewer_hub_user_did: HubUserDID;
  viewer_handle: HubHandle;
  pagination_key?: PaginationKey;
  limit?: number;
}

export function validateMeshListRepliesRequest(
  request: MeshListRepliesRequest,
): string[] {
  const fields: string[] = [];
  if (!isHubUserDID(request.owner_hub_user_did))
    fields.push("owner_hub_user_did");
  if (!isPostID(request.post_id)) fields.push("post_id");
  if (
    request.parent_reply_id !== undefined &&
    !isPostID(request.parent_reply_id)
  )
    fields.push("parent_reply_id");
  return [
    ...fields,
    ...validateViewer(request.viewer_hub_user_did, request.viewer_handle),
    ...validatePage(request.pagination_key, request.limit),
  ];
}

export interface MeshListRepliesResponse {
  replies: MeshReply[];
  next_pagination_key?: PaginationKey;
}

export interface MeshGetReplyRequest {
  owner_hub_user_did: HubUserDID;
  post_id: PostID;
  reply_id: PostID;
  viewer_hub_user_did: HubUserDID;
  viewer_handle: HubHandle;
}

export function validateMeshGetReplyRequest(
  request: MeshGetReplyRequest,
): string[] {
  const fields: string[] = [];
  if (!isHubUserDID(request.owner_hub_user_did))
    fields.push("owner_hub_user_did");
  if (!isPostID(request.post_id)) fields.push("post_id");
  if (!isPostID(request.reply_id)) fields.push("reply_id");
  return [
    ...fields,
    ...validateViewer(request.viewer_hub_user_did, request.viewer_handle),
  ];
}

/** Who wrote a parent reply, for the sub-reply block check. No words. */
export interface MeshGetReplyResponse {
  reply_id: PostID;
  post_id: PostID;
  parent_reply_id?: PostID;
  author_hub_user_did: HubUserDID;
  author_tenant_id: TenantID;
  author_handle: HubHandle;
  state: ThreadReplyState;
}

export interface MeshListAuthorRepliesRequest {
  author_hub_user_did: HubUserDID;
  viewer_hub_user_did: HubUserDID;
  viewer_handle: HubHandle;
  pagination_key?: PaginationKey;
  limit?: number;
}

export function validateMeshListAuthorRepliesRequest(
  request: MeshListAuthorRepliesRequest,
): string[] {
  const fields: string[] = [];
  if (!isHubUserDID(request.author_hub_user_did))
    fields.push("author_hub_user_did");
  return [
    ...fields,
    ...validateViewer(request.viewer_hub_user_did, request.viewer_handle),
    ...validatePage(request.pagination_key, request.limit),
  ];
}

export interface MeshListAuthorRepliesResponse {
  replies: AuthorReply[];
  next_pagination_key?: PaginationKey;
}
