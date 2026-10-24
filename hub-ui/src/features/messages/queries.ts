import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type {
  HubConversationDetail,
  ListConversationsResponse,
} from "typespec/hub/messages/messages";
import {
  Pending,
  type PendingOperation,
} from "typespec/hub/operations/operations";
import type {
  ContactID,
  ConversationMessage,
  MessageText,
} from "typespec/orgs/marketplace/contacts/contacts";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { usePendingOperations } from "../../app/PendingOperationContext";

export const conversationsQueryKey = ["hub", "conversations"] as const;
export const conversationDetailQueryKey = (contactId: string) =>
  ["hub", "conversations", contactId] as const;

export function useConversationsQuery(enabled = true) {
  return useQuery({
    queryKey: conversationsQueryKey,
    queryFn: () => hubAPI.listConversations(),
    enabled,
  });
}

export function useConversationDetailQuery(
  contactId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: conversationDetailQueryKey(contactId ?? ""),
    queryFn: () =>
      hubAPI.getConversation({ contact_id: contactId as ContactID }),
    enabled: Boolean(contactId) && enabled,
  });
}

export class OperationStillPendingError extends Error {
  constructor() {
    super("The operation is still pending");
    this.name = "OperationStillPendingError";
  }
}

const pollIntervalMilliseconds = 1000;
const maxPolls = 30;

function isPendingOperation(result: unknown): result is PendingOperation {
  return (
    result !== null &&
    typeof result === "object" &&
    "operation_id" in (result as Record<string, unknown>)
  );
}

async function settle(operationID: string): Promise<void> {
  for (let poll = 0; poll < maxPolls; poll++) {
    const status = await hubAPI.operationStatus({ operation_id: operationID });
    if (status.state !== Pending) return;
    await new Promise((resolve) =>
      window.setTimeout(resolve, pollIntervalMilliseconds),
    );
  }
  throw new OperationStillPendingError();
}

export function useConversationReplyAction(contactId: string) {
  const queryClient = useQueryClient();
  const { hold } = usePendingOperations();
  const key = useIdempotencyKey();
  const lastRequest = useRef<string | null>(null);

  return useMutation({
    mutationFn: async (text: MessageText) => {
      const request = { contact_id: contactId as ContactID, text };
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
          queryKey: conversationDetailQueryKey(contactId),
        }),
        queryClient.invalidateQueries({ queryKey: conversationsQueryKey }),
      ]);
    },
    onError: async (error) => {
      if (error instanceof OperationStillPendingError) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: conversationDetailQueryKey(contactId),
        }),
        queryClient.invalidateQueries({ queryKey: conversationsQueryKey }),
      ]);
    },
  });
}

export function useConversationDeleteAction(contactId: string) {
  const queryClient = useQueryClient();
  const { hold } = usePendingOperations();
  const key = useIdempotencyKey();
  const lastRequest = useRef<string | null>(null);

  return useMutation({
    mutationFn: async () => {
      const request = { contact_id: contactId as ContactID };
      const serialized = JSON.stringify(request);
      if (lastRequest.current !== null && lastRequest.current !== serialized) {
        key.rotate();
      }
      lastRequest.current = serialized;
      const release = hold();
      try {
        let result = await hubAPI.deleteConversation(request, key.current());
        while (isPendingOperation(result)) {
          await settle(result.operation_id);
          result = await hubAPI.deleteConversation(request, key.current());
        }
        return result;
      } finally {
        release();
      }
    },
    onSuccess: async () => {
      key.rotate();
      lastRequest.current = null;
      queryClient.removeQueries({
        queryKey: conversationDetailQueryKey(contactId),
      });
      await queryClient.invalidateQueries({ queryKey: conversationsQueryKey });
    },
    onError: async (error) => {
      if (error instanceof OperationStillPendingError) return;
      await queryClient.invalidateQueries({ queryKey: conversationsQueryKey });
    },
  });
}

export function useMarkConversationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (contactId: ContactID) =>
      hubAPI.markConversationRead({ contact_id: contactId }),
    onSuccess: (_, contactId) => {
      queryClient.setQueryData<ListConversationsResponse>(
        conversationsQueryKey,
        (current) => {
          if (!current) return current;
          return {
            ...current,
            items: current.items.map((item) =>
              item.contact_id === contactId
                ? { ...item, unread: false, unread_count: 0 }
                : item,
            ),
          };
        },
      );
      queryClient.setQueryData<HubConversationDetail>(
        conversationDetailQueryKey(contactId),
        (current) => {
          if (!current) return current;
          return {
            ...current,
            conversation: {
              ...current.conversation,
              unread: false,
              unread_count: 0,
            },
          };
        },
      );
    },
  });
}
