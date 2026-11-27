import type { PaginationKey } from "../../common/pagination.ts";
import {
  type HubHandle,
  type HubUserDID,
  isHubHandle,
  isHubUserDID,
} from "../types.ts";
import { isPostID, type Post, type PostID, validatePage } from "./posts.ts";

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
