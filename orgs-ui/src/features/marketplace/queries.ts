import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IdempotencyKey } from "typespec/common/idempotency";
import type { RouteApplicationRequest } from "typespec/orgs/applications/applications";
import type {
  AssignOpeningProviderRequest,
  UnassignOpeningProviderRequest,
} from "typespec/orgs/marketplace/assignments";
import type {
  EndEngagementRequest,
  EngagementID,
  EngagementTarget,
  ListEngagementsRequest,
  ProposeEngagementRequest,
  SetEngagementReferenceRequest,
} from "typespec/orgs/marketplace/engagements";
import type {
  GetListingRequest,
  SearchListingsRequest,
} from "typespec/orgs/marketplace/listings";
import type { GetActivityStatementRequest } from "typespec/orgs/marketplace/statements";
import { orgsAPI } from "../../api/orgs";
import { applicationsQueryKey } from "../applications/queries";
import { openingsQueryKey } from "../openings/queries";

export const marketplaceQueryKey = ["marketplace"] as const;

export function useSearchListingsQuery(
  request: SearchListingsRequest,
  enabled = true,
) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "listings", "search", request],
    queryFn: () => orgsAPI.searchListings(request),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useListingDetailQuery(
  request: GetListingRequest,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      ...marketplaceQueryKey,
      "listings",
      "detail",
      request.domain,
      request.capability,
    ],
    queryFn: () => orgsAPI.getListing(request),
    retry: false,
    enabled,
  });
}

export function useConsumerEngagementsQuery(
  request: ListEngagementsRequest = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "engagements", "list", request],
    queryFn: () => orgsAPI.listEngagements(request),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useConsumerEngagementQuery(
  engagementId: EngagementID | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "engagements", "detail", engagementId],
    queryFn: () =>
      engagementId
        ? orgsAPI.getEngagement({ engagement_id: engagementId })
        : Promise.reject(new Error("no engagement id")),
    retry: false,
    enabled: enabled && engagementId !== undefined,
  });
}

export function useProposeEngagementMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: ProposeEngagementRequest;
      key: IdempotencyKey;
    }) => orgsAPI.proposeEngagement(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "engagements"],
      });
    },
  });
}

export function useWithdrawEngagementMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: EngagementTarget;
      key: IdempotencyKey;
    }) => orgsAPI.withdrawEngagement(request, key),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "engagements"],
      });
      void queryClient.invalidateQueries({
        queryKey: [
          ...marketplaceQueryKey,
          "engagements",
          "detail",
          variables.request.engagement_id,
        ],
      });
    },
  });
}

export function useEndEngagementMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: EndEngagementRequest;
      key: IdempotencyKey;
    }) => orgsAPI.endEngagement(request, key),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "engagements"],
      });
      void queryClient.invalidateQueries({
        queryKey: [
          ...marketplaceQueryKey,
          "engagements",
          "detail",
          variables.request.engagement_id,
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "opening-providers"],
      });
    },
  });
}

export function useSetEngagementReferenceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: SetEngagementReferenceRequest;
      key: IdempotencyKey;
    }) => orgsAPI.setEngagementReference(request, key),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [
          ...marketplaceQueryKey,
          "engagements",
          "detail",
          variables.request.engagement_id,
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "engagements", "list"],
      });
    },
  });
}

export function useEngagementStatementQuery(
  request: GetActivityStatementRequest,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      ...marketplaceQueryKey,
      "engagements",
      "statement",
      request.engagement_id,
      request.month,
      request.pagination_key,
      request.limit,
    ],
    queryFn: () => orgsAPI.getEngagementStatement(request),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useOpeningProvidersQuery(
  openingNumber: number | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "opening-providers", openingNumber],
    queryFn: () =>
      openingNumber !== undefined
        ? orgsAPI.getOpeningProviders({ opening_number: openingNumber })
        : Promise.reject(new Error("no opening number")),
    retry: false,
    enabled: enabled && openingNumber !== undefined,
  });
}

export function useAssignOpeningProviderMutation(openingNumber: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: AssignOpeningProviderRequest;
      key: IdempotencyKey;
    }) => orgsAPI.assignOpeningProvider(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "opening-providers", openingNumber],
      });
      void queryClient.invalidateQueries({
        queryKey: [...openingsQueryKey, "opening", openingNumber],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "engagements"],
      });
    },
  });
}

export function useUnassignOpeningProviderMutation(openingNumber: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: UnassignOpeningProviderRequest;
      key: IdempotencyKey;
    }) => orgsAPI.unassignOpeningProvider(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "opening-providers", openingNumber],
      });
      void queryClient.invalidateQueries({
        queryKey: [...openingsQueryKey, "opening", openingNumber],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "engagements"],
      });
    },
  });
}

export function useRouteApplicationMutation(
  openingNumber: number,
  applicationNumber: number,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: RouteApplicationRequest;
      key: IdempotencyKey;
    }) => orgsAPI.routeApplication(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          ...applicationsQueryKey,
          "detail",
          openingNumber,
          applicationNumber,
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: [...applicationsQueryKey, "list"],
      });
    },
  });
}
