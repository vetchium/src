import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaginationKey } from "typespec/common/pagination";
import type {
  AICreditsResponse,
  AISettingsResponse,
  BuyAICreditPackRequest,
  SetAISettingsRequest,
} from "typespec/orgs/ai/ai";
import type { AIOperation, AIUsageID } from "typespec/orgs/ai/types";
import { AIUnavailableError } from "typespec/problem/orgs/ai";
import { APIError } from "../../api/client";
import { orgsAPI } from "../../api/orgs";

export const aiQueryKey = ["orgs", "ai"] as const;
const settingsKey = [...aiQueryKey, "settings"] as const;
const creditsKey = [...aiQueryKey, "credits"] as const;

/** The region offers no AI models; features hide instead of failing. */
export function isAIUnavailable(error: unknown): boolean {
  return (
    error instanceof APIError && error.problem?.type === AIUnavailableError.type
  );
}

export function useAIOptionsQuery(operation: AIOperation, enabled = true) {
  return useQuery({
    queryKey: [...aiQueryKey, "options", operation],
    queryFn: () => orgsAPI.getAIOptions({ operation }),
    retry: false,
    enabled,
  });
}

export function useAISettingsQuery() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: orgsAPI.aiSettings,
    retry: false,
  });
}

export function useSetAISettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: SetAISettingsRequest;
      key: string;
    }) => orgsAPI.setAISettings(request, key),
    onSuccess: (settings: AISettingsResponse) => {
      queryClient.setQueryData(settingsKey, settings);
      void queryClient.invalidateQueries({ queryKey: aiQueryKey });
    },
  });
}

export function useAICreditsQuery() {
  return useQuery({
    queryKey: creditsKey,
    queryFn: orgsAPI.aiCredits,
    retry: false,
  });
}

export function useBuyAICreditPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: BuyAICreditPackRequest;
      key: string;
    }) => orgsAPI.buyAICreditPack(request, key),
    onSuccess: (credits: AICreditsResponse) => {
      queryClient.setQueryData(creditsKey, credits);
      void queryClient.invalidateQueries({ queryKey: aiQueryKey });
    },
  });
}

export function useAICreditLotsQuery(
  limit: number,
  paginationKey: PaginationKey | undefined,
) {
  return useQuery({
    queryKey: [...aiQueryKey, "lots", limit, paginationKey],
    queryFn: () =>
      orgsAPI.listAICreditLots({
        limit,
        ...(paginationKey === undefined
          ? {}
          : { pagination_key: paginationKey }),
      }),
  });
}

export function useAIUsageQuery(
  limit: number,
  paginationKey: PaginationKey | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...aiQueryKey, "usage", limit, paginationKey],
    queryFn: () =>
      orgsAPI.listAIUsage({
        limit,
        ...(paginationKey === undefined
          ? {}
          : { pagination_key: paginationKey }),
      }),
    enabled,
  });
}

export function useAIUsageTextQuery(usageID: AIUsageID | undefined) {
  return useQuery({
    queryKey: [...aiQueryKey, "usage-text", usageID],
    queryFn: () => orgsAPI.getAIUsageText({ usage_id: usageID ?? "" }),
    enabled: usageID !== undefined,
    retry: false,
  });
}
