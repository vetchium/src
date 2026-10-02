import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { useRef } from "react";
import type { PaginationKey } from "typespec/common/pagination";
import type {
  OrgInvoice,
  OrgSubscription,
  SetSubscriptionPlanRequest,
} from "typespec/orgs/subscriptions/subscriptions";
import { orgsAPI } from "../../api/orgs";
import { myInfoQueryKey } from "../account/queries";

export const mySubscriptionQueryKey = ["orgs", "my-subscription"] as const;
export const invoicesQueryKey = ["orgs", "invoices"] as const;

export function useMySubscriptionQuery(enabled = true) {
  return useQuery({
    queryKey: mySubscriptionQueryKey,
    queryFn: orgsAPI.mySubscription,
    retry: false,
    enabled,
  });
}

export function useInvoicesQuery(key: PaginationKey | undefined) {
  return useQuery({
    queryKey: [...invoicesQueryKey, key ?? null],
    queryFn: () =>
      orgsAPI.listInvoices({
        limit: 10,
        ...(key === undefined ? {} : { pagination_key: key }),
      }),
    placeholderData: (previous) => previous,
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
    void queryClient.invalidateQueries({ queryKey: invoicesQueryKey });
    void queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
  };
}

/**
 * Rotates the idempotency key after the server decides and whenever the chosen
 * target changes, so a retry of one choice replays the same request while a
 * new choice gets a new key.
 */
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
    onError: () => refresh(),
  });
}

export function usePayInvoice() {
  const refresh = useRefreshBilling();
  const key = useIdempotencyKey();
  return useMutation({
    mutationFn: (invoice: OrgInvoice) =>
      orgsAPI.payInvoice({ invoice_id: invoice.invoice_id }, key.current()),
    onSuccess: (subscription) => {
      key.rotate();
      refresh(subscription);
    },
    onError: () => refresh(),
  });
}

export function useSetPaymentMethod() {
  const refresh = useRefreshBilling();
  return useMutation({
    mutationFn: orgsAPI.setPaymentMethod,
    onSuccess: () => refresh(),
  });
}

export function useRemovePaymentMethod() {
  const refresh = useRefreshBilling();
  return useMutation({
    mutationFn: orgsAPI.removePaymentMethod,
    onSuccess: () => refresh(),
  });
}
