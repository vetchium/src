import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { IdempotencyKey } from "typespec/common/idempotency";
import type { PaginationKey } from "typespec/common/pagination";
import type { RouteApplicationRequest } from "typespec/orgs/applications/applications";
import type {
  AssignOpeningProviderRequest,
  UnassignOpeningProviderRequest,
} from "typespec/orgs/marketplace/assignments";
import type { ListCreditedApplicationsRequest } from "typespec/orgs/marketplace/attribution";
import type {
  AddContactNoteRequest,
  AddPersonNoteRequest,
  DeleteContactNoteRequest,
  EditContactNoteRequest,
  ListContactsRequest,
  SendMessageRequest,
  StartConversationRequest,
} from "typespec/orgs/marketplace/contacts/contacts";
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
  ListJobsRequest,
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

// ---------------------------------------------------------------------------
// Agency: Jobs, Contacts, and Credited applications
// ---------------------------------------------------------------------------

export function useJobsQuery(request: ListJobsRequest = {}, enabled = true) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "jobs", "list", request],
    queryFn: () => orgsAPI.listJobs(request),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useJobQuery(
  engagementId: string,
  openingNumber: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      ...marketplaceQueryKey,
      "jobs",
      "detail",
      engagementId,
      openingNumber,
    ],
    queryFn: () =>
      orgsAPI.getJob({
        engagement_id: engagementId,
        opening_number: openingNumber,
      }),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useCreditedApplicationsQuery(
  request: ListCreditedApplicationsRequest = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [
      ...marketplaceQueryKey,
      "credited-applications",
      "list",
      request,
    ],
    queryFn: () => orgsAPI.listCreditedApplications(request),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useContactsQuery(
  request: ListContactsRequest = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "contacts", "list", request],
    queryFn: () => orgsAPI.listContacts(request),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useContactQuery(contactId: string, enabled = true) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "contacts", "detail", contactId],
    queryFn: () => orgsAPI.getContact({ contact_id: contactId }),
    placeholderData: (previous) => previous,
    retry: false,
    enabled: enabled && contactId !== "",
  });
}

export function useViewHubProfileQuery(address: string, enabled = true) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "hub-profile", address],
    queryFn: () => orgsAPI.viewHubProfile({ address }),
    placeholderData: (previous) => previous,
    retry: false,
    enabled: enabled && address.trim() !== "",
  });
}

export function useContactNotesQuery(contactId: string, enabled = true) {
  return useQuery({
    queryKey: [...marketplaceQueryKey, "contact-notes", contactId],
    queryFn: () => orgsAPI.listContactNotes({ contact_id: contactId }),
    placeholderData: (previous) => previous,
    retry: false,
    enabled: enabled && contactId !== "",
  });
}

export function useAddPersonNoteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: AddPersonNoteRequest;
      key: IdempotencyKey;
    }) => orgsAPI.addPersonNote(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contacts", "list"],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "hub-profile"],
      });
    },
  });
}

export function useAddContactNoteMutation(contactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: AddContactNoteRequest;
      key: IdempotencyKey;
    }) => orgsAPI.addContactNote(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contact-notes", contactId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contacts", "detail", contactId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contacts", "list"],
      });
    },
  });
}

export function useEditContactNoteMutation(contactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: EditContactNoteRequest;
      key: IdempotencyKey;
    }) => orgsAPI.editContactNote(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contact-notes", contactId],
      });
    },
  });
}

export function useDeleteContactNoteMutation(contactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: DeleteContactNoteRequest;
      key: IdempotencyKey;
    }) => orgsAPI.deleteContactNote(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contact-notes", contactId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contacts", "detail", contactId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contacts", "list"],
      });
    },
  });
}

/** Pages of a conversation, newest first; each page lists newest first. */
export function useConversationQuery(contactId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...marketplaceQueryKey, "conversation", contactId],
    queryFn: ({ pageParam }) =>
      orgsAPI.getConversation({
        contact_id: contactId,
        ...(pageParam !== undefined && { pagination_key: pageParam }),
      }),
    initialPageParam: undefined as PaginationKey | undefined,
    getNextPageParam: (page) => page.next_pagination_key,
    retry: false,
    enabled: enabled && contactId !== "",
  });
}

export function useStartConversationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: StartConversationRequest;
      key: IdempotencyKey;
    }) => orgsAPI.startConversation(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contacts", "list"],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "hub-profile"],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "jobs"],
      });
    },
  });
}

export function useSendMessageMutation(contactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: {
      request: SendMessageRequest;
      key: IdempotencyKey;
    }) => orgsAPI.sendMessage(request, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "conversation", contactId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contacts", "detail", contactId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contacts", "list"],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "jobs"],
      });
    },
  });
}

export function useMarkConversationReadMutation(contactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => orgsAPI.markConversationRead({ contact_id: contactId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "conversation", contactId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contacts", "detail", contactId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...marketplaceQueryKey, "contacts", "list"],
      });
    },
  });
}
