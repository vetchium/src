import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";
import type { PaginationKey } from "typespec/common/pagination";
import {
  type HubConversationDetail,
  type HubSendChatRequestRequest,
  type ListConversationsResponse,
  type ListOpeningAgenciesResponse,
  maxPage,
} from "typespec/hub/messages/messages";
import type { PendingOperation } from "typespec/hub/operations/operations";
import type {
  ChatRequestDeclineScope,
  ChatRequestDirection,
  ChatRequestNumber,
  ConversationMessage,
  MessageNumber,
  MessageText,
} from "typespec/orgs/marketplace/contacts/contacts";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { usePendingOperations } from "../../app/PendingOperationContext";
import { OperationStillPendingError, settle } from "../applications/actions";

export const conversationsQueryKey = ["hub", "conversations"] as const;
export const conversationDetailQueryKey = (agencyDomain: string) =>
  ["hub", "conversations", agencyDomain] as const;
const awaitingCountQueryKey = ["hub", "conversations-awaiting"] as const;
const chatRequestsQueryKey = ["hub", "chat-requests"] as const;
const openingAgenciesQueryKey = ["hub", "opening-agencies"] as const;

export function useConversationsQuery(enabled = true) {
  return useQuery({
    queryKey: conversationsQueryKey,
    queryFn: () => hubAPI.listConversations(),
    enabled,
  });
}

/** Conversations waiting on the user: a chat request to answer, or unread
 * agency messages (MKT-HUB-001). */
export function useAwaitingConversationCountQuery(enabled = true) {
  return useQuery({
    queryKey: awaitingCountQueryKey,
    queryFn: () => hubAPI.countAwaitingConversations(),
    enabled,
  });
}

/** Pages of a conversation, newest first; each page lists newest first. */
export function useConversationDetailQuery(
  agencyDomain: string | undefined,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: conversationDetailQueryKey(agencyDomain ?? ""),
    queryFn: ({ pageParam }) =>
      hubAPI.getConversation({
        agency_domain: agencyDomain ?? "",
        ...(pageParam === undefined ? {} : { pagination_key: pageParam }),
      }),
    initialPageParam: undefined as PaginationKey | undefined,
    getNextPageParam: (page) => page.next_pagination_key,
    enabled: Boolean(agencyDomain) && enabled,
  });
}

/** Pending requests oldest first, then answered ones newest first. */
export function useChatRequestsQuery(direction: ChatRequestDirection) {
  return useQuery({
    queryKey: [...chatRequestsQueryKey, direction],
    queryFn: () => hubAPI.listChatRequests({ direction, limit: maxPage }),
  });
}

/** The agencies recruiting for a `published` Opening, with the user's chat
 * state with each (MKT-HUB-005). */
export function useOpeningAgenciesQuery(
  domain: string,
  openingNumber: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...openingAgenciesQueryKey, domain, openingNumber],
    queryFn: () =>
      hubAPI.listOpeningAgencies({ domain, opening_number: openingNumber }),
    retry: false,
    enabled,
  });
}

/** The messages of the loaded pages, oldest first. */
export function chronological(
  pages: readonly HubConversationDetail[] | undefined,
): ConversationMessage[] {
  return (pages ?? []).flatMap((page) => page.messages).reverse();
}

function isPendingOperation(result: unknown): result is PendingOperation {
  return (
    result !== null &&
    typeof result === "object" &&
    "operation_id" in (result as Record<string, unknown>)
  );
}

export function useConversationReplyAction(agencyDomain: string) {
  const queryClient = useQueryClient();
  const { hold } = usePendingOperations();
  const key = useIdempotencyKey();
  const lastRequest = useRef<string | null>(null);

  return useMutation({
    mutationFn: async (text: MessageText) => {
      const request = { agency_domain: agencyDomain, text };
      const serialized = JSON.stringify(request);
      if (lastRequest.current !== null && lastRequest.current !== serialized) {
        key.rotate();
      }
      lastRequest.current = serialized;
      const release = hold();
      try {
        let result = await hubAPI.replyToConversation(request, key.current());
        while (isPendingOperation(result)) {
          await settle(result.operation_id);
          result = await hubAPI.replyToConversation(request, key.current());
        }
        return result as ConversationMessage;
      } finally {
        release();
      }
    },
    onSuccess: async () => {
      key.rotate();
      lastRequest.current = null;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: conversationDetailQueryKey(agencyDomain),
        }),
        queryClient.invalidateQueries({ queryKey: conversationsQueryKey }),
      ]);
    },
    onError: async (error) => {
      if (error instanceof OperationStillPendingError) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: conversationDetailQueryKey(agencyDomain),
        }),
        queryClient.invalidateQueries({ queryKey: conversationsQueryKey }),
      ]);
    },
  });
}

/** Deletes one of the user's own text messages; the agency sees that a
 * message was deleted, never what it said (MKT-CNV-007). */
export function useMessageDeleteAction(agencyDomain: string) {
  const queryClient = useQueryClient();
  const { hold } = usePendingOperations();
  const key = useIdempotencyKey();
  const lastRequest = useRef<string | null>(null);

  return useMutation({
    mutationFn: async (messageNumber: MessageNumber) => {
      const request = {
        agency_domain: agencyDomain,
        message_number: messageNumber,
      };
      const serialized = JSON.stringify(request);
      if (lastRequest.current !== null && lastRequest.current !== serialized) {
        key.rotate();
      }
      lastRequest.current = serialized;
      const release = hold();
      try {
        let result = await hubAPI.deleteMessage(request, key.current());
        while (isPendingOperation(result)) {
          await settle(result.operation_id);
          result = await hubAPI.deleteMessage(request, key.current());
        }
        return result as ConversationMessage;
      } finally {
        release();
      }
    },
    onSuccess: async () => {
      key.rotate();
      lastRequest.current = null;
      await queryClient.invalidateQueries({
        queryKey: conversationDetailQueryKey(agencyDomain),
      });
    },
    onError: async (error) => {
      if (error instanceof OperationStillPendingError) return;
      await queryClient.invalidateQueries({
        queryKey: conversationDetailQueryKey(agencyDomain),
      });
    },
  });
}

export function useMarkConversationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agencyDomain: string) =>
      hubAPI.markConversationRead({ agency_domain: agencyDomain }),
    onSuccess: (_, agencyDomain) => {
      void queryClient.invalidateQueries({ queryKey: awaitingCountQueryKey });
      queryClient.setQueryData<ListConversationsResponse>(
        conversationsQueryKey,
        (current) => {
          if (!current) return current;
          return {
            ...current,
            items: current.items.map((item) =>
              item.agency_domain === agencyDomain
                ? { ...item, unread: false, unread_count: 0 }
                : item,
            ),
          };
        },
      );
      queryClient.setQueryData<InfiniteData<HubConversationDetail>>(
        conversationDetailQueryKey(agencyDomain),
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              conversation: {
                ...page.conversation,
                unread: false,
                unread_count: 0,
              },
            })),
          },
      );
    },
  });
}

/** Accepts the request, or declines it with a scope (MKT-REQ-007). */
export interface ChatRequestAnswer {
  request_number: ChatRequestNumber;
  decline?: ChatRequestDeclineScope;
}

export function useChatRequestAnswerAction(agencyDomain: string) {
  const queryClient = useQueryClient();
  const { hold } = usePendingOperations();
  const key = useIdempotencyKey();
  const lastRequest = useRef<string | null>(null);

  const refresh = (list = true) =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: conversationDetailQueryKey(agencyDomain),
      }),
      list &&
        queryClient.invalidateQueries({ queryKey: conversationsQueryKey }),
      queryClient.invalidateQueries({ queryKey: chatRequestsQueryKey }),
      queryClient.invalidateQueries({ queryKey: awaitingCountQueryKey }),
    ]);

  return useMutation({
    mutationFn: async (answer: ChatRequestAnswer) => {
      const serialized = JSON.stringify(answer);
      if (lastRequest.current !== null && lastRequest.current !== serialized) {
        key.rotate();
      }
      lastRequest.current = serialized;
      const call = () =>
        answer.decline === undefined
          ? hubAPI.acceptChatRequest(
              {
                agency_domain: agencyDomain,
                request_number: answer.request_number,
              },
              key.current(),
            )
          : hubAPI.declineChatRequest(
              {
                agency_domain: agencyDomain,
                request_number: answer.request_number,
                scope: answer.decline,
              },
              key.current(),
            );
      const release = hold();
      try {
        let result = await call();
        while (isPendingOperation(result)) {
          await settle(result.operation_id);
          result = await call();
        }
        return result;
      } finally {
        release();
      }
    },
    onSuccess: async (result) => {
      key.rotate();
      lastRequest.current = null;
      if ("conversation" in result) {
        // The list and the agencies list read the pointer, whose window and
        // suggestions wait for the agency's pointer event; the accept
        // response already carries them, so a refetch would go back in time.
        const live = result.conversation;
        queryClient.setQueryData<ListConversationsResponse>(
          conversationsQueryKey,
          (data) =>
            data && {
              ...data,
              items: data.items.some(
                (item) => item.agency_domain === agencyDomain,
              )
                ? data.items.map((item) =>
                    item.agency_domain === agencyDomain ? live : item,
                  )
                : [live, ...data.items],
            },
        );
        const until = live.hub_may_write_until;
        const open = until !== undefined && Date.parse(until) > Date.now();
        queryClient.setQueriesData<ListOpeningAgenciesResponse>(
          { queryKey: openingAgenciesQueryKey },
          (data) =>
            data && {
              ...data,
              items: data.items.map((item) =>
                item.agency_domain === agencyDomain
                  ? { ...item, chat_state: open ? "open" : "closed" }
                  : item,
              ),
            },
        );
        await refresh(false);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: openingAgenciesQueryKey }),
        refresh(),
      ]);
    },
    onError: async (error) => {
      if (error instanceof OperationStillPendingError) return;
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: openingAgenciesQueryKey }),
      ]);
    },
  });
}

export function useSendChatRequestAction() {
  const queryClient = useQueryClient();
  const { hold } = usePendingOperations();
  const key = useIdempotencyKey();
  const lastRequest = useRef<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: openingAgenciesQueryKey }),
      queryClient.invalidateQueries({ queryKey: conversationsQueryKey }),
      queryClient.invalidateQueries({ queryKey: chatRequestsQueryKey }),
    ]);

  return useMutation({
    mutationFn: async (request: HubSendChatRequestRequest) => {
      const serialized = JSON.stringify(request);
      if (lastRequest.current !== null && lastRequest.current !== serialized) {
        key.rotate();
      }
      lastRequest.current = serialized;
      const release = hold();
      try {
        let result = await hubAPI.sendChatRequest(request, key.current());
        while (isPendingOperation(result)) {
          await settle(result.operation_id);
          result = await hubAPI.sendChatRequest(request, key.current());
        }
        return result;
      } finally {
        release();
      }
    },
    onSuccess: async () => {
      key.rotate();
      lastRequest.current = null;
      await refresh();
    },
    onError: async (error) => {
      if (error instanceof OperationStillPendingError) return;
      await refresh();
    },
  });
}
