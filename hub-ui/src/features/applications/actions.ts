import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { IdempotencyKey } from "typespec/common/idempotency";
import type { ApplicationReference } from "typespec/hub/applications/applications";
import {
  Pending,
  type PendingOperation,
} from "typespec/hub/operations/operations";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { usePendingOperations } from "../../app/PendingOperationContext";
import { applicationsQueryKey } from "./queries";

/** The Org's tenant did not confirm in time; the request stays safe to retry
 * because it keeps its idempotency key. */
export class OperationStillPendingError extends Error {
  constructor() {
    super("The operation is still pending");
    this.name = "OperationStillPendingError";
  }
}

const pollIntervalMilliseconds = 1000;
const maxPolls = 30;

type WriteResult = ApplicationReference | PendingOperation;

function isPendingOperation(result: WriteResult): result is PendingOperation {
  return "operation_id" in result;
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

/**
 * Sends one write to an application. A `202` means the outcome is not yet
 * known: poll the operation, then replay the same request with the same
 * idempotency key for the typed result or problem. Leaving the page is held
 * while this runs, because the replayed response is not repeated elsewhere.
 */
export function useApplicationAction<Request>(
  send: (
    request: Request,
    idempotencyKey: IdempotencyKey,
  ) => Promise<WriteResult>,
) {
  const queryClient = useQueryClient();
  const { hold } = usePendingOperations();
  const key = useIdempotencyKey();
  const lastRequest = useRef<string | null>(null);
  return useMutation({
    mutationFn: async (request: Request) => {
      const serialized = JSON.stringify(request);
      if (lastRequest.current !== null && lastRequest.current !== serialized) {
        key.rotate();
      }
      lastRequest.current = serialized;
      const release = hold();
      try {
        let result = await send(request, key.current());
        while (isPendingOperation(result)) {
          await settle(result.operation_id);
          result = await send(request, key.current());
        }
        return result;
      } finally {
        release();
      }
    },
    onSuccess: async () => {
      key.rotate();
      lastRequest.current = null;
      await queryClient.invalidateQueries({ queryKey: applicationsQueryKey });
    },
    // A refusal means the application moved on without this page; show where
    // it stands now.
    onError: async (error) => {
      if (error instanceof OperationStillPendingError) return;
      await queryClient.invalidateQueries({ queryKey: applicationsQueryKey });
    },
  });
}
