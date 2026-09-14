import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { SetSubscriptionPlanRequest } from "typespec/hub/subscriptions/subscriptions";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";

export const mySubscriptionQueryKey = ["hub", "my-subscription"] as const;

export function useMySubscriptionQuery() {
  return useQuery({
    queryKey: mySubscriptionQueryKey,
    queryFn: hubAPI.mySubscription,
    retry: false,
  });
}

function targetKey(request: SetSubscriptionPlanRequest): string {
  return `${request.plan_oid}:${request.billing_interval ?? ""}`;
}

/**
 * Rotates the idempotency key after success and whenever the chosen target
 * changes. A retry of one choice then replays the same request; a new choice
 * gets a new key.
 */
export function useSetSubscriptionPlan() {
  const queryClient = useQueryClient();
  const key = useIdempotencyKey();
  const lastTarget = useRef<string | null>(null);

  return useMutation({
    mutationFn: (request: SetSubscriptionPlanRequest) => {
      const nextTarget = targetKey(request);
      if (lastTarget.current !== null && lastTarget.current !== nextTarget) {
        key.rotate();
      }
      lastTarget.current = nextTarget;
      return hubAPI.setSubscriptionPlan(request, key.current());
    },
    onSuccess: (subscription) => {
      key.rotate();
      lastTarget.current = null;
      queryClient.setQueryData(mySubscriptionQueryKey, subscription);
    },
  });
}
