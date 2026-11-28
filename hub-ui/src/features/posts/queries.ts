import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";
import type { IdempotencyKey } from "typespec/common/idempotency";
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
  type CreateQuoteRequest,
  type DetachQuoteRequest,
  normalizeCreateQuoteRequest,
  normalizeDetachQuoteRequest,
} from "typespec/hub/posts/quotes";
import {
  type EditReplyRequest,
  type HideReplyRequest,
  type ListRepliesResponse,
  normalizeEditReplyRequest,
  normalizeLocateReplyRequest,
  normalizeReplyRequest,
  type Reply,
  type ReplyRequest,
} from "typespec/hub/posts/replies";
import { maxCardHandles, type ProfileCard } from "typespec/hub/profile/cards";
import { HubReplyNotFoundError } from "typespec/problem/hub/posts";
import { isProblem } from "../../api/client";
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

/**
 * Holds one Idempotency-Key for one draft. A retry of the same request sends
 * the same key, so a lost answer does not post twice. A changed request or a
 * success takes a new key.
 */
function useDraftKey() {
  const key = useIdempotencyKey();
  const lastRequest = useRef<string | null>(null);
  return {
    keyFor(request: unknown): IdempotencyKey {
      const serialized = JSON.stringify(request);
      if (lastRequest.current !== null && lastRequest.current !== serialized) {
        key.rotate();
      }
      lastRequest.current = serialized;
      return key.current();
    },
    done(): void {
      key.rotate();
      lastRequest.current = null;
    },
  };
}

export function useCreatePostMutation() {
  const invalidate = usePostsInvalidation();
  const draft = useDraftKey();
  return useMutation({
    mutationFn: (request: CreatePostRequest) => {
      const normalized = normalizeCreatePostRequest(request);
      return hubAPI.createPost(normalized, draft.keyFor(normalized));
    },
    onSuccess: () => {
      draft.done();
      return invalidate();
    },
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
 * a missing next key ends the list (PST-THR-005). `fromReplyID` starts the
 * list at one reply, for a reply link (PST-THR-009).
 */
export function useRepliesQuery(
  owner: string,
  postID: string,
  parentReplyID: string | undefined,
  fromReplyID: string | undefined,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: [
      ...repliesQueryKey,
      "list",
      owner,
      postID,
      parentReplyID ?? "",
      fromReplyID ?? "",
    ],
    queryFn: ({ pageParam }) =>
      hubAPI.listReplies({
        owner,
        post_id: postID,
        ...(parentReplyID !== undefined && { parent_reply_id: parentReplyID }),
        limit: pageSize,
        ...(pageParam !== undefined
          ? { pagination_key: pageParam }
          : fromReplyID !== undefined && { from_reply_id: fromReplyID }),
      }),
    initialPageParam: undefined as PaginationKey | undefined,
    getNextPageParam: (page) => page.next_pagination_key,
    retry: false,
    enabled,
  });
}

/**
 * Finds the parent of a reply that a link names (PST-THR-009). It returns
 * `null` for a top-level reply, the parent ID for a sub-reply, and `false`
 * when the reply is not there (a query cannot hold `undefined`).
 */
export function useLocateReply(
  owner: string,
  postID: string,
  replyID: string | undefined,
) {
  return useQuery({
    queryKey: [...repliesQueryKey, "locate", owner, postID, replyID ?? ""],
    queryFn: async (): Promise<string | null | false> => {
      if (replyID === undefined) return false;
      try {
        const found = await hubAPI.locateReply(
          normalizeLocateReplyRequest({
            owner,
            post_id: postID,
            reply_id: replyID,
          }),
        );
        return found.parent_reply_id ?? null;
      } catch (error) {
        if (isProblem(error, HubReplyNotFoundError.type)) return false;
        throw error;
      }
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
  const draft = useDraftKey();
  return useMutation({
    mutationFn: async (reply: ReplyRequest) => {
      const request = normalizeReplyRequest(reply);
      const key = draft.keyFor(request);
      const release = hold();
      try {
        let result = await hubAPI.reply(request, key);
        while (isPending(result)) {
          await settle(result.operation_id);
          result = await hubAPI.reply(request, key);
        }
        return result;
      } finally {
        release();
      }
    },
    onSuccess: async () => {
      draft.done();
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
 * The post owner's tenant learns of an edit or a removal after the author's
 * tenant answers, so a thread read right after the write can still show the
 * old words. These writes patch the cached threads instead of reloading them.
 */
function patchThreads(
  queryClient: QueryClient,
  replyID: string,
  patch: (reply: Reply) => Reply | null,
): void {
  queryClient.setQueriesData<InfiniteData<ListRepliesResponse>>(
    { queryKey: [...repliesQueryKey, "list"] },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          replies: page.replies.flatMap((reply) => {
            if (reply.reply_id !== replyID) return [reply];
            const next = patch(reply);
            return next === null ? [] : [next];
          }),
        })),
      },
  );
}

/** Reloads what the author's tenant answers at once, but not the threads. */
function refreshOutsideThreads(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: postsQueryKey,
    predicate: (query) => query.queryKey[2] !== "replies",
  });
}

/** An edit answers with `child_count` 0, so the patch keeps the real count. */
export function useEditReplyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: EditReplyRequest) =>
      hubAPI.editReply(normalizeEditReplyRequest(request)),
    onSuccess: (edited) => {
      patchThreads(queryClient, edited.reply_id, (reply) => ({
        ...reply,
        body: edited.body,
        revision: edited.revision,
        edited: edited.edited,
      }));
      return refreshOutsideThreads(queryClient);
    },
  });
}

/** A removed reply with sub-replies stays as a placeholder (PST-THR-004). */
function removedReply(shown: Reply): Reply | null {
  if (shown.child_count === 0) return null;
  const { body: _body, ...rest } = shown;
  return { ...rest, state: "placeholder", revision: 1, edited: false };
}

/** Removes a reply by its ID, from a thread or from the Replies tab. */
export function useRemoveReplyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (replyID: string) => hubAPI.removeReply({ reply_id: replyID }),
    onSuccess: (_, replyID) => {
      patchThreads(queryClient, replyID, removedReply);
      return refreshOutsideThreads(queryClient);
    },
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

/** A quote lands in the quoter's profile and the target's quote count. */
export function useCreateQuoteMutation() {
  const invalidate = usePostsInvalidation();
  const draft = useDraftKey();
  return useMutation({
    mutationFn: (request: CreateQuoteRequest) => {
      const normalized = normalizeCreateQuoteRequest(request);
      return hubAPI.createQuote(normalized, draft.keyFor(normalized));
    },
    onSuccess: () => {
      draft.done();
      return invalidate();
    },
  });
}

/** The quotes of one post, newest first (PST-QTE-012). */
export function useQuotesQuery(
  owner: string,
  postID: string,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: [...postsQueryKey, "quotes", owner, postID],
    queryFn: ({ pageParam }) =>
      hubAPI.listQuotes({
        owner,
        post_id: postID,
        limit: pageSize,
        ...(pageParam !== undefined && { pagination_key: pageParam }),
      }),
    initialPageParam: undefined as PaginationKey | undefined,
    getNextPageParam: (page) => page.next_pagination_key,
    retry: false,
    enabled,
  });
}

export function useDetachQuoteMutation() {
  const invalidate = usePostsInvalidation();
  return useMutation({
    mutationFn: (request: DetachQuoteRequest) =>
      hubAPI.detachQuote(normalizeDetachQuoteRequest(request)),
    onSuccess: invalidate,
  });
}
