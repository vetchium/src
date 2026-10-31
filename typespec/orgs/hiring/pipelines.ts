import type { PageSize, PaginationKey } from "../../common/pagination.ts";
import { isPageSize, isPaginationKey } from "../../common/pagination.ts";
import type { StageKind } from "./vocabulary.ts";
import { InterviewStage, isStageKind } from "./vocabulary.ts";

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

export const CriterionRating = "rating" as const;
export const CriterionYesNo = "yes_no" as const;
export const CriterionText = "text" as const;
/** How an interviewer answers a criterion (HP-FRM-001). */
export type FeedbackCriterionType =
  | typeof CriterionRating
  | typeof CriterionYesNo
  | typeof CriterionText
  | (string & {});

export const maxFeedbackCriteria = 10;
const maxFeedbackCriterion = 500;

export function isFeedbackCriterionType(value: string): boolean {
  return (
    value === CriterionRating ||
    value === CriterionYesNo ||
    value === CriterionText
  );
}

export type FeedbackCriterionID = string;

/** Accepts the lowercase form the API returns. */
export function isFeedbackCriterionID(value: string): boolean {
  return uuidPattern.test(value);
}

/** One criterion of an interview stage's form; omit `id` for a new one. */
export interface FeedbackCriterion {
  id?: FeedbackCriterionID;
  text: string;
  type: FeedbackCriterionType;
  required: boolean;
}

export function normalizeFeedbackForm(
  form: FeedbackCriterion[],
): FeedbackCriterion[] {
  return form.map((criterion) => ({
    ...criterion,
    text: criterion.text.trim(),
  }));
}

/**
 * Reports invalid fields under prefix (the form's own path). Only an interview
 * stage has a form; `seen` collects ids across the pipeline.
 */
export function validateFeedbackForm(
  prefix: string,
  kind: StageKind,
  form: FeedbackCriterion[] | undefined,
  seen: Set<string>,
): string[] {
  if (form === undefined || form.length === 0) return [];
  if (kind !== InterviewStage || form.length > maxFeedbackCriteria)
    return [prefix];
  const fields: string[] = [];
  form.forEach((criterion, index) => {
    const path = `${prefix}.${index}`;
    if (criterion.id !== undefined) {
      if (!isFeedbackCriterionID(criterion.id) || seen.has(criterion.id))
        fields.push(`${path}.id`);
      seen.add(criterion.id);
    }
    const length = Array.from(criterion.text).length;
    if (
      length < 1 ||
      length > maxFeedbackCriterion ||
      criterion.text !== criterion.text.trim()
    )
      fields.push(`${path}.text`);
    if (!isFeedbackCriterionType(criterion.type)) fields.push(`${path}.type`);
  });
  return fields;
}

/** A stage as a template or a new Opening describes it. */
export interface PipelineStageDefinition {
  name: PipelineName;
  kind: StageKind;
  /** Interview stages only; responses carry it for every interview stage. */
  feedback_form?: FeedbackCriterion[];
}

/** A stage of an Opening's pipeline. */
export interface PipelineStage {
  id: PipelineStageID;
  name: PipelineName;
  kind: StageKind;
  /** Pipeline and interview reads carry it for every interview stage. */
  feedback_form?: FeedbackCriterion[];
}

export function normalizeStageDefinitions(
  stages: PipelineStageDefinition[],
): PipelineStageDefinition[] {
  return stages.map((stage) => ({
    name: normalizePipelineName(stage.name),
    kind: stage.kind,
    ...(stage.feedback_form !== undefined && {
      feedback_form: normalizeFeedbackForm(stage.feedback_form),
    }),
  }));
}

export function validateStageDefinitions(
  prefix: string,
  stages: PipelineStageDefinition[],
): string[] {
  if (stages.length < 1 || stages.length > maxPipelineStages) return [prefix];
  const fields: string[] = [];
  const seen = new Set<string>();
  stages.forEach((stage, index) => {
    if (!isPipelineName(stage.name)) fields.push(`${prefix}.${index}.name`);
    if (!isStageKind(stage.kind)) fields.push(`${prefix}.${index}.kind`);
    fields.push(
      ...validateFeedbackForm(
        `${prefix}.${index}.feedback_form`,
        stage.kind,
        stage.feedback_form,
        seen,
      ),
    );
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
