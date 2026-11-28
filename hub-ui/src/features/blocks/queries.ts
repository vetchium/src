import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { PaginationKey } from "typespec/common/pagination";
import {
  type BlockUserRequest,
  normalizeBlockUserRequest,
} from "typespec/hub/blocks/blocks";
import { hubAPI } from "../../api/hub";

export const blocksQueryKey = ["hub", "blocks"] as const;

const pageSize = 20;

export function useBlockedUsersQuery() {
  return useInfiniteQuery({
    queryKey: [...blocksQueryKey, "blocked"],
    queryFn: ({ pageParam }) =>
      hubAPI.listBlockedUsers({
        limit: pageSize,
        ...(pageParam !== undefined && { pagination_key: pageParam }),
      }),
    initialPageParam: undefined as PaginationKey | undefined,
    getNextPageParam: (page) => page.next_pagination_key,
    retry: false,
  });
}

export function useMutedUsersQuery() {
  return useInfiniteQuery({
    queryKey: [...blocksQueryKey, "muted"],
    queryFn: ({ pageParam }) =>
      hubAPI.listMutedUsers({
        limit: pageSize,
        ...(pageParam !== undefined && { pagination_key: pageParam }),
      }),
    initialPageParam: undefined as PaginationKey | undefined,
    getNextPageParam: (page) => page.next_pagination_key,
    retry: false,
  });
}

/** The caller's block and mute of one user, for the profile menu. */
export function useBlockStateQuery(address: string, enabled: boolean) {
  return useQuery({
    queryKey: [...blocksQueryKey, "state", address],
    queryFn: () =>
      hubAPI.blockState(normalizeBlockUserRequest({ user: address })),
    retry: false,
    enabled,
  });
}

type BlockAction = "block" | "unblock" | "mute" | "unmute";

const actions: Record<BlockAction, (body: BlockUserRequest) => Promise<void>> =
  {
    block: hubAPI.blockUser,
    unblock: hubAPI.unblockUser,
    mute: hubAPI.muteUser,
    unmute: hubAPI.unmuteUser,
  };

/** Runs one block or mute change, then refreshes every list and state. */
export function useBlockActionMutation(action: BlockAction) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (address: string) =>
      actions[action](normalizeBlockUserRequest({ user: address })),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: blocksQueryKey }),
  });
}
