import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { useRef } from "react";
import type {
  OrgSubscription,
  SetSubscriptionPlanRequest,
} from "typespec/orgs/subscriptions/subscriptions";
import { isDefiniteRefusal } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { myInfoQueryKey } from "../account/queries";
import { userSummaryQueryKey } from "../users/queries";

export const mySubscriptionQueryKey = ["orgs", "my-subscription"] as const;

export function useMySubscriptionQuery(enabled = true) {
  return useQuery({
    queryKey: mySubscriptionQueryKey,
    queryFn: orgsAPI.mySubscription,
    retry: false,
    enabled,
  });
}

function targetKey(request: SetSubscriptionPlanRequest): string {
  return `${request.plan_oid}:${request.billing_interval ?? ""}`;
}

/** Everything a billing change can alter in what the portal shows. */
function useRefreshBilling() {
  const queryClient = useQueryClient();
  return (subscription?: OrgSubscription) => {
    if (subscription !== undefined) {
      queryClient.setQueryData(mySubscriptionQueryKey, subscription);
    } else {
      void queryClient.invalidateQueries({ queryKey: mySubscriptionQueryKey });
    }
    void queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
    void queryClient.invalidateQueries({ queryKey: userSummaryQueryKey });
  };
}

/** Keep the same key across uncertain outcomes and rotate when the target changes. */
export function useSetSubscriptionPlan() {
  const refresh = useRefreshBilling();
  const key = useIdempotencyKey();
  const lastTarget = useRef<string | null>(null);

  return useMutation({
    mutationFn: (request: SetSubscriptionPlanRequest) => {
      const nextTarget = targetKey(request);
      if (lastTarget.current !== null && lastTarget.current !== nextTarget) {
        key.rotate();
      }
      lastTarget.current = nextTarget;
      return orgsAPI.setSubscriptionPlan(request, key.current());
    },
    onSuccess: (subscription) => {
      key.rotate();
      lastTarget.current = null;
      refresh(subscription);
    },
    onError: (error) => {
      if (isDefiniteRefusal(error)) {
        key.rotate();
        lastTarget.current = null;
      }
      refresh();
    },
  });
}
