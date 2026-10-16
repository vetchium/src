import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IdempotencyKey } from "typespec/common/idempotency";
import type {
  CreateOpeningRequest,
  DecideOpeningRequestRequest,
  DiscardOpeningRequest,
  DiscardOpeningWorkingCopyRequest,
  DuplicateOpeningRequest,
  ListOpeningHistoryRequest,
  ListOpeningsRequest,
  RequestOpeningChangeRequest,
  SaveOpeningWorkingCopyRequest,
  SetOpeningTeamRequest,
  WithdrawOpeningRequestRequest,
} from "typespec/orgs/openings/openings";
import { orgsAPI } from "../../api/orgs";

export const openingsQueryKey = ["orgs", "openings"] as const;
export const openingSummaryQueryKey = ["orgs", "opening-summary"] as const;

export function useOpeningsQuery(request: ListOpeningsRequest, enabled = true) {
  return useQuery({
    queryKey: [...openingsQueryKey, "list", request],
    queryFn: () => orgsAPI.listOpenings(request),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useOpeningQuery(openingNumber: number) {
  return useQuery({
    queryKey: [...openingsQueryKey, "detail", openingNumber],
    queryFn: () => orgsAPI.getOpening({ opening_number: openingNumber }),
    enabled: Number.isInteger(openingNumber) && openingNumber > 0,
  });
}

export function useOpeningSummaryQuery() {
  return useQuery({
    queryKey: openingSummaryQueryKey,
    queryFn: orgsAPI.openingSummary,
    retry: false,
  });
}

export function useOpeningHistoryQuery(request: ListOpeningHistoryRequest) {
  return useQuery({
    queryKey: [...openingsQueryKey, "history", request],
    queryFn: () => orgsAPI.listOpeningHistory(request),
    placeholderData: (previous) => previous,
  });
}

interface IdempotentAction<Request> {
  request: Request;
  key: IdempotencyKey;
}

function useOpeningMutation<Request>(
  action: (
    request: Request,
    key: IdempotencyKey,
  ) => ReturnType<typeof orgsAPI.createOpening>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ request, key }: IdempotentAction<Request>) =>
      action(request, key),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: openingsQueryKey }),
        queryClient.invalidateQueries({ queryKey: openingSummaryQueryKey }),
      ]);
    },
  });
}

export const useCreateOpeningMutation = () =>
  useOpeningMutation<CreateOpeningRequest>(orgsAPI.createOpening);
export const useDuplicateOpeningMutation = () =>
  useOpeningMutation<DuplicateOpeningRequest>(orgsAPI.duplicateOpening);
export const useSaveOpeningWorkingCopyMutation = () =>
  useOpeningMutation<SaveOpeningWorkingCopyRequest>(
    orgsAPI.saveOpeningWorkingCopy,
  );
export const useDiscardOpeningWorkingCopyMutation = () =>
  useOpeningMutation<DiscardOpeningWorkingCopyRequest>(
    orgsAPI.discardOpeningWorkingCopy,
  );
export const useSetOpeningTeamMutation = () =>
  useOpeningMutation<SetOpeningTeamRequest>(orgsAPI.setOpeningTeam);
export const useDiscardOpeningMutation = () =>
  useOpeningMutation<DiscardOpeningRequest>(orgsAPI.discardOpening);
export const useRequestOpeningChangeMutation = () =>
  useOpeningMutation<RequestOpeningChangeRequest>(orgsAPI.requestOpeningChange);
export const useDecideOpeningRequestMutation = () =>
  useOpeningMutation<DecideOpeningRequestRequest>(orgsAPI.decideOpeningRequest);
export const useWithdrawOpeningRequestMutation = () =>
  useOpeningMutation<WithdrawOpeningRequestRequest>(
    orgsAPI.withdrawOpeningRequest,
  );
