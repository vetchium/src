import type { PageSize, PaginationKey } from "../../common/pagination.ts";
import { isPageSize, isPaginationKey } from "../../common/pagination.ts";
import type { StageKind } from "./vocabulary.ts";
import { isStageKind } from "./vocabulary.ts";

/** Bounds one pipeline, template or Opening. */
export const maxPipelineStages = 15;
/** Bounds the templates one Org keeps. */
export const maxPipelineTemplates = 50;
const maxPipelineName = 100;

export type PipelineName = string;
export type PipelineTemplateID = string;
export type PipelineStageID = string;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Accepts the lowercase form the API returns. */
export function isPipelineTemplateID(value: string): boolean {
  return uuidPattern.test(value);
}

/** Accepts the lowercase form the API returns. */
export function isPipelineStageID(value: string): boolean {
  return uuidPattern.test(value);
}

export function normalizePipelineName(value: string): string {
  return value.trim();
}

/** Reports a trimmed name of 1 to 100 code points. */
export function isPipelineName(value: string): boolean {
  const length = Array.from(value).length;
  return length >= 1 && length <= maxPipelineName && value === value.trim();
}

/** A stage as a template or a new Opening describes it. */
export interface PipelineStageDefinition {
  name: PipelineName;
  kind: StageKind;
}

/** A stage of an Opening's pipeline. */
export interface PipelineStage {
  id: PipelineStageID;
  name: PipelineName;
  kind: StageKind;
}

export function normalizeStageDefinitions(
  stages: PipelineStageDefinition[],
): PipelineStageDefinition[] {
  return stages.map((stage) => ({
    name: normalizePipelineName(stage.name),
    kind: stage.kind,
  }));
}

export function validateStageDefinitions(
  prefix: string,
  stages: PipelineStageDefinition[],
): string[] {
  if (stages.length < 1 || stages.length > maxPipelineStages) return [prefix];
  const fields: string[] = [];
  stages.forEach((stage, index) => {
    if (!isPipelineName(stage.name)) fields.push(`${prefix}.${index}.name`);
    if (!isStageKind(stage.kind)) fields.push(`${prefix}.${index}.kind`);
  });
  return fields;
}

export interface PipelineTemplate {
  id: PipelineTemplateID;
  name: PipelineName;
  stages: PipelineStageDefinition[];
  created_at: string;
  updated_at: string;
}

export interface ListPipelineTemplatesRequest {
  pagination_key?: PaginationKey;
  limit?: PageSize;
}

export interface ListPipelineTemplatesResponse {
  templates: PipelineTemplate[];
  next_pagination_key?: PaginationKey;
}

export function validateListPipelineTemplatesRequest(
  request: ListPipelineTemplatesRequest,
): string[] {
  const fields: string[] = [];
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  )
    fields.push("pagination_key");
  if (request.limit !== undefined && !isPageSize(request.limit))
    fields.push("limit");
  return fields;
}

export interface CreatePipelineTemplateRequest {
  name: PipelineName;
  stages: PipelineStageDefinition[];
}

export function normalizeCreatePipelineTemplateRequest(
  request: CreatePipelineTemplateRequest,
): CreatePipelineTemplateRequest {
  return {
    name: normalizePipelineName(request.name),
    stages: normalizeStageDefinitions(request.stages),
  };
}

export function validateCreatePipelineTemplateRequest(
  request: CreatePipelineTemplateRequest,
): string[] {
  const fields: string[] = [];
  if (!isPipelineName(request.name)) fields.push("name");
  return [...fields, ...validateStageDefinitions("stages", request.stages)];
}

export interface UpdatePipelineTemplateRequest {
  template_id: PipelineTemplateID;
  name: PipelineName;
  stages: PipelineStageDefinition[];
}

export function normalizeUpdatePipelineTemplateRequest(
  request: UpdatePipelineTemplateRequest,
): UpdatePipelineTemplateRequest {
  return {
    template_id: request.template_id,
    name: normalizePipelineName(request.name),
    stages: normalizeStageDefinitions(request.stages),
  };
}

export function validateUpdatePipelineTemplateRequest(
  request: UpdatePipelineTemplateRequest,
): string[] {
  const fields: string[] = [];
  if (!isPipelineTemplateID(request.template_id)) fields.push("template_id");
  if (!isPipelineName(request.name)) fields.push("name");
  return [...fields, ...validateStageDefinitions("stages", request.stages)];
}

export interface DeletePipelineTemplateRequest {
  template_id: PipelineTemplateID;
}

export function validateDeletePipelineTemplateRequest(
  request: DeletePipelineTemplateRequest,
): string[] {
  return isPipelineTemplateID(request.template_id) ? [] : ["template_id"];
}
