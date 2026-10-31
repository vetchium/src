import type {
  FeedbackCriterion,
  PipelineName,
  PipelineStage,
  PipelineStageID,
} from "../hiring/pipelines.ts";
import {
  isPipelineName,
  isPipelineStageID,
  maxPipelineStages,
  normalizeFeedbackForm,
  normalizePipelineName,
  validateFeedbackForm,
} from "../hiring/pipelines.ts";
import type { StageKind } from "../hiring/vocabulary.ts";
import { isStageKind } from "../hiring/vocabulary.ts";
import type { OpeningNumber, OpeningVersion } from "./types.ts";

/** A stage of a replacement pipeline. Omit the id to add a stage. */
export interface PipelineStageInput {
  id?: PipelineStageID;
  name: PipelineName;
  kind: StageKind;
  /** Interview stages only; an id must name one this stage already holds. */
  feedback_form?: FeedbackCriterion[];
}

/** A stage with what the Pipeline tab warns about (HP-FRM-002). */
export interface OpeningPipelineStage extends PipelineStage {
  feedback_submitted_count: number;
}

export interface OpeningPipeline {
  opening_number: OpeningNumber;
  version: OpeningVersion;
  stages: OpeningPipelineStage[];
}

export interface GetOpeningPipelineRequest {
  opening_number: OpeningNumber;
}

export function validateGetOpeningPipelineRequest(
  request: GetOpeningPipelineRequest,
): string[] {
  return Number.isInteger(request.opening_number) && request.opening_number >= 1
    ? []
    : ["opening_number"];
}

export interface ReplaceOpeningPipelineRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
  stages: PipelineStageInput[];
}

export function normalizeReplaceOpeningPipelineRequest(
  request: ReplaceOpeningPipelineRequest,
): ReplaceOpeningPipelineRequest {
  return {
    ...request,
    stages: request.stages.map((stage) => ({
      ...stage,
      name: normalizePipelineName(stage.name),
      ...(stage.feedback_form !== undefined && {
        feedback_form: normalizeFeedbackForm(stage.feedback_form),
      }),
    })),
  };
}

export function validateReplaceOpeningPipelineRequest(
  request: ReplaceOpeningPipelineRequest,
): string[] {
  const fields: string[] = [];
  if (!Number.isInteger(request.opening_number) || request.opening_number < 1)
    fields.push("opening_number");
  if (!Number.isInteger(request.version) || request.version < 1)
    fields.push("version");
  if (request.stages.length < 1 || request.stages.length > maxPipelineStages)
    return [...fields, "stages"];
  const seen = new Set<string>();
  const criteria = new Set<string>();
  request.stages.forEach((stage, index) => {
    if (stage.id !== undefined) {
      if (!isPipelineStageID(stage.id) || seen.has(stage.id))
        fields.push(`stages.${index}.id`);
      seen.add(stage.id);
    }
    if (!isPipelineName(stage.name)) fields.push(`stages.${index}.name`);
    if (!isStageKind(stage.kind)) fields.push(`stages.${index}.kind`);
    fields.push(
      ...validateFeedbackForm(
        `stages.${index}.feedback_form`,
        stage.kind,
        stage.feedback_form,
        criteria,
      ),
    );
  });
  return fields;
}
