import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { IdempotencyKey } from "typespec/common/idempotency";
import type {
  ApplicationActionRequest,
  ApplicationDetail,
  ApplicationJoinedOnRequest,
  ApplicationSeparatedOnRequest,
  ApplicationStageRequest,
  ListApplicationsRequest,
} from "typespec/orgs/applications/applications";
import { orgsAPI } from "../../api/orgs";
import { openingsQueryKey } from "../openings/queries";

// Under the Openings key so every Opening change refreshes them and every
// application change refreshes the Opening's counts.
export const applicationsQueryKey = [
  ...openingsQueryKey,
  "applications",
] as const;

export function useApplicationsQuery(
  request: ListApplicationsRequest,
  enabled = true,
) {
  return useQuery({
    queryKey: [...applicationsQueryKey, "list", request],
    queryFn: () => orgsAPI.listApplications(request),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

function detailKey(openingNumber: number, applicationNumber: number) {
  return [
    ...applicationsQueryKey,
    "detail",
    openingNumber,
    applicationNumber,
  ] as const;
}

export function useApplicationQuery(
  openingNumber: number,
  applicationNumber: number,
) {
  return useQuery({
    queryKey: detailKey(openingNumber, applicationNumber),
    queryFn: () =>
      orgsAPI.getApplication({
        opening_number: openingNumber,
        application_number: applicationNumber,
      }),
    retry: false,
  });
}

export function useApplicationHistoryQuery(
  openingNumber: number,
  applicationNumber: number,
) {
  return useInfiniteQuery({
    queryKey: [
      ...applicationsQueryKey,
      "history",
      openingNumber,
      applicationNumber,
    ],
    queryFn: ({ pageParam }) =>
      orgsAPI.listApplicationHistory({
        opening_number: openingNumber,
        application_number: applicationNumber,
        limit: 25,
        ...(pageParam !== undefined && { pagination_key: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_pagination_key,
    retry: false,
  });
}

interface IdempotentAction<Request> {
  request: Request;
  key: IdempotencyKey;
}

function useApplicationMutation<Request extends ApplicationActionRequest>(
  action: (request: Request, key: IdempotencyKey) => Promise<ApplicationDetail>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ request, key }: IdempotentAction<Request>) =>
      action(request, key),
    onSuccess: async (detail, { request }) => {
      // The next action needs the new version before the refetch lands.
      queryClient.setQueryData(
        detailKey(request.opening_number, request.application_number),
        detail,
      );
      await queryClient.invalidateQueries({ queryKey: openingsQueryKey });
    },
  });
}

export const useShortlistApplicationMutation = () =>
  useApplicationMutation<ApplicationStageRequest>(orgsAPI.shortlistApplication);
export const useMoveApplicationStageMutation = () =>
  useApplicationMutation<ApplicationStageRequest>(orgsAPI.moveApplicationStage);
export const useCompleteApplicationStageMutation = () =>
  useApplicationMutation<ApplicationActionRequest>(
    orgsAPI.completeApplicationStage,
  );
export const useNotProgressingMutation = () =>
  useApplicationMutation<ApplicationActionRequest>(
    orgsAPI.markApplicationNotProgressing,
  );
export const useRecordJoinedMutation = () =>
  useApplicationMutation<ApplicationJoinedOnRequest>(
    orgsAPI.recordApplicationJoined,
  );
export const useRecordDidNotJoinMutation = () =>
  useApplicationMutation<ApplicationActionRequest>(
    orgsAPI.recordApplicationDidNotJoin,
  );
export const useRecordSeparatedMutation = () =>
  useApplicationMutation<ApplicationSeparatedOnRequest>(
    orgsAPI.recordApplicationSeparated,
  );
export const useCorrectJoinedOnMutation = () =>
  useApplicationMutation<ApplicationJoinedOnRequest>(
    orgsAPI.correctApplicationJoinedOn,
  );
export const useCorrectSeparatedOnMutation = () =>
  useApplicationMutation<ApplicationSeparatedOnRequest>(
    orgsAPI.correctApplicationSeparatedOn,
  );
