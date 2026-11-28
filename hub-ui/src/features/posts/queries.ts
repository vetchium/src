import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";
import type { PaginationKey } from "typespec/common/pagination";
import type { PendingOperation } from "typespec/hub/operations/operations";
import {
  type CreatePostRequest,
  type EditPostRequest,
  normalizeCreatePostRequest,
  normalizeEditPostRequest,
  type Post,
  type SetPostPoliciesRequest,
} from "typespec/hub/posts/posts";
import {
  type EditReplyRequest,
  type HideReplyRequest,
  normalizeEditReplyRequest,
  normalizeReplyRequest,
  type Reply,
  type ReplyRequest,
} from "typespec/hub/posts/replies";
import { maxCardHandles, type ProfileCard } from "typespec/hub/profile/cards";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { usePendingOperations } from "../../app/PendingOperationContext";
import { OperationStillPendingError, settle } from "../applications/actions";

export const postsQueryKey = ["hub", "posts"] as const;

const pageSize = 20;

/** The live posts of one profile, newest first (PST-POS-011). */
export function usePostsQuery(owner: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...postsQueryKey, "list", owner],
    queryFn: ({ pageParam }) =>
      hubAPI.listPosts({
        owner,
        limit: pageSize,
        ...(pageParam !== undefined && { pagination_key: pageParam }),
      }),
    initialPageParam: undefined as PaginationKey | undefined,
    getNextPageParam: (page) => page.next_pagination_key,
    retry: false,
    enabled,
  });
}

export function usePostQuery(owner: string, postID: string, enabled: boolean) {
  return useQuery({
    queryKey: [...postsQueryKey, "get", owner, postID],
    queryFn: () => hubAPI.getPost({ owner, post_id: postID }),
    retry: false,
    enabled,
  });
}

function usePostsInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: postsQueryKey });
}

export function useCreatePostMutation() {
  const invalidate = usePostsInvalidation();
  return useMutation({
    mutationFn: (request: CreatePostRequest) =>
      hubAPI.createPost(normalizeCreatePostRequest(request)),
    onSuccess: invalidate,
  });
}

export function useEditPostMutation() {
  const invalidate = usePostsInvalidation();
  return useMutation({
    mutationFn: (request: EditPostRequest) =>
      hubAPI.editPost(normalizeEditPostRequest(request)),
    onSuccess: invalidate,
  });
}

export function useSetPostPoliciesMutation() {
  const invalidate = usePostsInvalidation();
  return useMutation({
    mutationFn: (request: SetPostPoliciesRequest) =>
      hubAPI.setPostPolicies(request),
    onSuccess: invalidate,
  });
}

export function useRemovePostMutation() {
  const invalidate = usePostsInvalidation();
  return useMutation({
    mutationFn: (post: Post) => hubAPI.removePost({ post_id: post.post_id }),
    onSuccess: invalidate,
  });
}

/**
 * Reads display names and pictures for handles. The handles show first; a
 * handle without a card stays a handle (PST-THR-006).
 */
export function useProfileCards(handles: readonly string[]) {
  const unique = [...new Set(handles)].sort();
  return useQuery({
    queryKey: ["hub", "profile-cards", unique],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < unique.length; i += maxCardHandles) {
        chunks.push(unique.slice(i, i + maxCardHandles));
      }
      const responses = await Promise.all(
        chunks.map((chunk) => hubAPI.readCards({ handles: chunk })),
      );
      return new Map<string, ProfileCard>(
        responses.flatMap((response) =>
          response.cards.map((card) => [card.handle, card] as const),
        ),
      );
    },
    retry: false,
    enabled: unique.length > 0,
  });
}

const repliesQueryKey = [...postsQueryKey, "replies"] as const;

/**
 * One page-by-page list of replies: the top-level replies of a post, or the
 * sub-replies of one top-level reply (PST-THR-002). A page can be short; only
 * a missing next key ends the list (PST-THR-005).
 */
export function useRepliesQuery(
  owner: string,
  postID: string,
  parentReplyID: string | undefined,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: [...repliesQueryKey, "list", owner, postID, parentReplyID ?? ""],
    queryFn: ({ pageParam }) =>
      hubAPI.listReplies({
        owner,
        post_id: postID,
        ...(parentReplyID !== undefined && { parent_reply_id: parentReplyID }),
        limit: pageSize,
        ...(pageParam !== undefined && { pagination_key: pageParam }),
      }),
    initialPageParam: undefined as PaginationKey | undefined,
    getNextPageParam: (page) => page.next_pagination_key,
    retry: false,
    enabled,
  });
}

/**
 * Finds the parent of a reply that a link names. It returns `null` for a
 * top-level reply, the parent ID for a sub-reply, and `undefined` when no
 * page holds the reply. The thread has no read for one reply, so it pages.
 */
export function useLocateReply(
  owner: string,
  postID: string,
  replyID: string | undefined,
) {
  return useQuery({
    queryKey: [...repliesQueryKey, "locate", owner, postID, replyID ?? ""],
    queryFn: async (): Promise<string | null | undefined> => {
      if (replyID === undefined) return undefined;
      const parents: string[] = [];
      const scan = async (parent: string | undefined) => {
        let key: PaginationKey | undefined;
        do {
          const page = await hubAPI.listReplies({
            owner,
            post_id: postID,
            ...(parent !== undefined && { parent_reply_id: parent }),
            limit: 50,
            ...(key !== undefined && { pagination_key: key }),
          });
          if (page.replies.some((reply) => reply.reply_id === replyID)) {
            return true;
          }
          if (parent === undefined) {
            parents.push(
              ...page.replies
                .filter((reply) => reply.child_count > 0)
                .map((reply) => reply.reply_id),
            );
          }
          key = page.next_pagination_key;
        } while (key !== undefined);
        return false;
      };
      if (await scan(undefined)) return null;
      for (const parent of parents) {
        if (await scan(parent)) return parent;
      }
      return undefined;
    },
    retry: false,
    staleTime: Infinity,
    enabled: replyID !== undefined,
  });
}

/**
 * Writes a reply. A `202` means the post owner's tenant has not answered yet:
 * poll the operation, then replay the same request with the same key. One key
 * lasts for one draft, so a retry after an error does not post twice.
 */
export function useReplyMutation() {
  const queryClient = useQueryClient();
  const { hold } = usePendingOperations();
  const key = useIdempotencyKey();
  const lastRequest = useRef<string | null>(null);
  return useMutation({
    mutationFn: async (draft: ReplyRequest) => {
      const request = normalizeReplyRequest(draft);
      const serialized = JSON.stringify(request);
      if (lastRequest.current !== null && lastRequest.current !== serialized) {
        key.rotate();
      }
      lastRequest.current = serialized;
      const release = hold();
      try {
        let result = await hubAPI.reply(request, key.current());
        while (isPending(result)) {
          await settle(result.operation_id);
          result = await hubAPI.reply(request, key.current());
        }
        return result;
      } finally {
        release();
      }
    },
    onSuccess: async () => {
      key.rotate();
      lastRequest.current = null;
      await queryClient.invalidateQueries({ queryKey: postsQueryKey });
    },
    onError: async (error) => {
      if (error instanceof OperationStillPendingError) return;
      await queryClient.invalidateQueries({ queryKey: postsQueryKey });
    },
  });
}

function isPending(
  result: Reply | PendingOperation,
): result is PendingOperation {
  return "operation_id" in result;
}

/**
 * An edit answers with `child_count` 0, because the author's tenant keeps no
 * sub-reply counts. The thread reloads instead, so it keeps the real count.
 */
export function useEditReplyMutation() {
  const invalidate = usePostsInvalidation();
  return useMutation({
    mutationFn: (request: EditReplyRequest) =>
      hubAPI.editReply(normalizeEditReplyRequest(request)),
    onSuccess: invalidate,
  });
}

export function useRemoveReplyMutation() {
  const invalidate = usePostsInvalidation();
  return useMutation({
    mutationFn: (reply: Reply) =>
      hubAPI.removeReply({ reply_id: reply.reply_id }),
    onSuccess: invalidate,
  });
}

export function useHideReplyMutation() {
  const invalidate = usePostsInvalidation();
  return useMutation({
    mutationFn: (request: { hide: boolean } & HideReplyRequest) =>
      request.hide
        ? hubAPI.hideReply({
            post_id: request.post_id,
            reply_id: request.reply_id,
          })
        : hubAPI.unhideReply({
            post_id: request.post_id,
            reply_id: request.reply_id,
          }),
    onSuccess: invalidate,
  });
}

/** The replies one user wrote, newest first (PST-TAB-001). */
export function useAuthorRepliesQuery(owner: string) {
  return useInfiniteQuery({
    queryKey: [...postsQueryKey, "author-replies", owner],
    queryFn: ({ pageParam }) =>
      hubAPI.listAuthorReplies({
        owner,
        limit: pageSize,
        ...(pageParam !== undefined && { pagination_key: pageParam }),
      }),
    initialPageParam: undefined as PaginationKey | undefined,
    getNextPageParam: (page) => page.next_pagination_key,
    retry: false,
  });
}
