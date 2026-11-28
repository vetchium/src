import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { PaginationKey } from "typespec/common/pagination";
import {
  type CreatePostRequest,
  type EditPostRequest,
  normalizeCreatePostRequest,
  normalizeEditPostRequest,
  type Post,
  type SetPostPoliciesRequest,
} from "typespec/hub/posts/posts";
import { maxCardHandles, type ProfileCard } from "typespec/hub/profile/cards";
import { hubAPI } from "../../api/hub";

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
