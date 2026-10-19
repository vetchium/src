import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IdempotencyKey } from "typespec/common/idempotency";
import type {
  CreatePipelineTemplateRequest,
  DeletePipelineTemplateRequest,
  PipelineTemplate,
  UpdatePipelineTemplateRequest,
} from "typespec/orgs/hiring/pipelines";
import type { ReplaceOpeningPipelineRequest } from "typespec/orgs/openings/pipeline";
import { orgsAPI } from "../../api/orgs";
import { openingsQueryKey } from "../openings/queries";

export const pipelineTemplatesQueryKey = [
  "orgs",
  "pipeline-templates",
] as const;

/** Templates are few (at most 50), so one request reads every page. */
async function allTemplates(): Promise<PipelineTemplate[]> {
  const templates: PipelineTemplate[] = [];
  let paginationKey: string | undefined;
  do {
    const page = await orgsAPI.listPipelineTemplates({
      limit: 50,
      ...(paginationKey !== undefined && { pagination_key: paginationKey }),
    });
    templates.push(...page.templates);
    paginationKey = page.next_pagination_key;
  } while (paginationKey !== undefined);
  return templates;
}

export function usePipelineTemplatesQuery(enabled = true) {
  return useQuery({
    queryKey: pipelineTemplatesQueryKey,
    queryFn: allTemplates,
    enabled,
  });
}

interface IdempotentAction<Request> {
  request: Request;
  key: IdempotencyKey;
}

function useTemplateMutation<Request>(
  action: (request: Request, key: IdempotencyKey) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ request, key }: IdempotentAction<Request>) =>
      action(request, key),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: pipelineTemplatesQueryKey }),
  });
}

export const useCreatePipelineTemplateMutation = () =>
  useTemplateMutation<CreatePipelineTemplateRequest>(
    orgsAPI.createPipelineTemplate,
  );
export const useUpdatePipelineTemplateMutation = () =>
  useTemplateMutation<UpdatePipelineTemplateRequest>(
    orgsAPI.updatePipelineTemplate,
  );
export const useDeletePipelineTemplateMutation = () =>
  useTemplateMutation<DeletePipelineTemplateRequest>(
    orgsAPI.deletePipelineTemplate,
  );

export function openingPipelineQueryKey(openingNumber: number) {
  return [...openingsQueryKey, "pipeline", openingNumber] as const;
}

export function useOpeningPipelineQuery(openingNumber: number) {
  return useQuery({
    queryKey: openingPipelineQueryKey(openingNumber),
    queryFn: () =>
      orgsAPI.getOpeningPipeline({ opening_number: openingNumber }),
  });
}

/**
 * Candidacies per stage. Readable only by callers who may read applications,
 * so a refusal just leaves the counts out.
 */
export function useStageCountsQuery(openingNumber: number) {
  return useQuery({
    queryKey: [...openingsQueryKey, "stage-counts", openingNumber],
    queryFn: () =>
      orgsAPI.getApplicationCounts({ opening_number: openingNumber }),
    retry: false,
  });
}

export function useReplaceOpeningPipelineMutation(openingNumber: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      key,
    }: IdempotentAction<ReplaceOpeningPipelineRequest>) =>
      orgsAPI.replaceOpeningPipeline(request, key),
    onSuccess: async (pipeline) => {
      queryClient.setQueryData(
        openingPipelineQueryKey(openingNumber),
        pipeline,
      );
      await queryClient.invalidateQueries({ queryKey: openingsQueryKey });
    },
  });
}
