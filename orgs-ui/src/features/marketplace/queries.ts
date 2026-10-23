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
  CreateListingRequest,
  GetListingRequest,
  ListingTarget,
  SearchListingsRequest,
  UpdateListingRequest,
} from "typespec/orgs/marketplace/listings";
import type { GetActivityStatementRequest } from "typespec/orgs/marketplace/statements";
import type {
  InterviewReference,
  ListWorkQueueRequest,
  RecordAssessmentRequest,
  ChangeInterviewRequest as WorkChangeInterviewRequest,
  RecordBackgroundCheckResultRequest as WorkRecordBackgroundCheckResultRequest,
  RecordInterviewOutcomeRequest as WorkRecordInterviewOutcomeRequest,
  WorkReference,
  ScheduleInterviewRequest as WorkScheduleInterviewRequest,
  SubmitInterviewFeedbackRequest as WorkSubmitInterviewFeedbackRequest,
} from "typespec/orgs/marketplace/work/work";
import { orgsAPI } from "../../api/orgs";
import { applicationsQueryKey } from "../applications/queries";
import { openingsQueryKey } from "../openings/queries";

export const marketplaceQueryKey = ["marketplace"] as const;

export function useMyListingsQuery(enabled = true) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "listings", "mine"],
    queryFn: () => orgsAPI.listListings(),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useCreateListingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: CreateListingRequest;
      key: IdempotencyKey;
    }) => orgsAPI.createListing(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "listings", "mine"],
      });
    },
  });
}

export function useUpdateListingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: UpdateListingRequest;
      key: IdempotencyKey;
    }) => orgsAPI.updateListing(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "listings", "mine"],
      });
    },
  });
}

export function usePublishListingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: ListingTarget;
      key: IdempotencyKey;
    }) => orgsAPI.publishListing(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "listings", "mine"],
      });
    },
  });
}

export function useUnlistListingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: ListingTarget;
      key: IdempotencyKey;
    }) => orgsAPI.unlistListing(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "listings", "mine"],
      });
    },
  });
}

export function useDeleteListingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: ListingTarget;
      key: IdempotencyKey;
    }) => orgsAPI.deleteListing(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "listings", "mine"],
      });
    },
  });
}

export function useClientEngagementsQuery(
  request: ListEngagementsRequest = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "client-engagements", "list", request],
    queryFn: () => orgsAPI.listClientEngagements(request),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useClientEngagementQuery(
  engagementId: EngagementID | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      ...marketplaceQueryKey,
      "client-engagements",
      "detail",
      engagementId,
    ],
    queryFn: () =>
      engagementId
        ? orgsAPI.getClientEngagement({ engagement_id: engagementId })
        : Promise.reject(new Error("no engagement id")),
    retry: false,
    enabled: enabled && engagementId !== undefined,
  });
}

export function useClientEngagementStatementQuery(
  request: GetActivityStatementRequest,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      ...marketplaceQueryKey,
      "client-engagements",
      "statement",
      request.engagement_id,
      request.month,
      request.pagination_key,
      request.limit,
    ],
    queryFn: () => orgsAPI.getClientEngagementStatement(request),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useAcceptEngagementMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: EngagementTarget;
      key: IdempotencyKey;
    }) => orgsAPI.acceptEngagement(request, key),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(
        [
          ...marketplaceQueryKey,
          "client-engagements",
          "detail",
          variables.request.engagement_id,
        ],
        data,
      );
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "client-engagements", "list"],
      });
    },
  });
}

export function useDeclineEngagementMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: EngagementTarget;
      key: IdempotencyKey;
    }) => orgsAPI.declineEngagement(request, key),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "client-engagements", "list"],
      });
      void queryClient.invalidateQueries({
        queryKey: [
          ...marketplaceQueryKey,
          "client-engagements",
          "detail",
          variables.request.engagement_id,
        ],
      });
    },
  });
}

export function useEndClientEngagementMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: EndEngagementRequest;
      key: IdempotencyKey;
    }) => orgsAPI.endClientEngagement(request, key),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(
        [
          ...marketplaceQueryKey,
          "client-engagements",
          "detail",
          variables.request.engagement_id,
        ],
        data,
      );
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "client-engagements", "list"],
      });
    },
  });
}

export function useSetClientEngagementReferenceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: SetEngagementReferenceRequest;
      key: IdempotencyKey;
    }) => orgsAPI.setClientEngagementReference(request, key),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(
        [
          ...marketplaceQueryKey,
          "client-engagements",
          "detail",
          variables.request.engagement_id,
        ],
        data,
      );
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "client-engagements", "list"],
      });
    },
  });
}

export function useWorkQueueQuery(
  request: ListWorkQueueRequest = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "work-queue", request],
    queryFn: () => orgsAPI.listWorkQueue(request),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useWorkItemQuery(
  reference: WorkReference | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      ...marketplaceQueryKey,
      "work-item",
      reference?.engagement_id,
      reference?.work_id,
    ],
    queryFn: () =>
      reference
        ? orgsAPI.getWorkItem(reference)
        : Promise.reject(new Error("no work reference")),
    retry: false,
    enabled:
      enabled &&
      reference !== undefined &&
      !!reference.engagement_id &&
      !!reference.work_id,
  });
}

export function useScheduleWorkInterviewMutation(reference: WorkReference) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: WorkScheduleInterviewRequest;
      key: IdempotencyKey;
    }) => orgsAPI.scheduleWorkInterview(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          ...marketplaceQueryKey,
          "work-item",
          reference.engagement_id,
          reference.work_id,
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "work-queue"],
      });
    },
  });
}

export function useChangeWorkInterviewMutation(reference: WorkReference) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: WorkChangeInterviewRequest;
      key: IdempotencyKey;
    }) => orgsAPI.changeWorkInterview(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          ...marketplaceQueryKey,
          "work-item",
          reference.engagement_id,
          reference.work_id,
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "work-queue"],
      });
    },
  });
}

export function useCancelWorkInterviewMutation(reference: WorkReference) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: InterviewReference;
      key: IdempotencyKey;
    }) => orgsAPI.cancelWorkInterview(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          ...marketplaceQueryKey,
          "work-item",
          reference.engagement_id,
          reference.work_id,
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "work-queue"],
      });
    },
  });
}

export function useRecordWorkInterviewOutcomeMutation(
  reference: WorkReference,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: WorkRecordInterviewOutcomeRequest;
      key: IdempotencyKey;
    }) => orgsAPI.recordWorkInterviewOutcome(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          ...marketplaceQueryKey,
          "work-item",
          reference.engagement_id,
          reference.work_id,
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "work-queue"],
      });
    },
  });
}

export function useSubmitWorkInterviewFeedbackMutation(
  reference: WorkReference,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: WorkSubmitInterviewFeedbackRequest;
      key: IdempotencyKey;
    }) => orgsAPI.submitWorkInterviewFeedback(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          ...marketplaceQueryKey,
          "work-item",
          reference.engagement_id,
          reference.work_id,
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "work-queue"],
      });
    },
  });
}

export function useRecordWorkAssessmentMutation(reference: WorkReference) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: RecordAssessmentRequest;
      key: IdempotencyKey;
    }) => orgsAPI.recordWorkAssessment(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          ...marketplaceQueryKey,
          "work-item",
          reference.engagement_id,
          reference.work_id,
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "work-queue"],
      });
    },
  });
}

export function useRecordWorkBackgroundCheckResultMutation(
  reference: WorkReference,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: WorkRecordBackgroundCheckResultRequest;
      key: IdempotencyKey;
    }) => orgsAPI.recordWorkBackgroundCheckResult(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          ...marketplaceQueryKey,
          "work-item",
          reference.engagement_id,
          reference.work_id,
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "work-queue"],
      });
    },
  });
}

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
