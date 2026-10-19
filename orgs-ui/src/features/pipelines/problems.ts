import { ValidationFailedError } from "typespec/problem/details";
import {
  OpeningStateConflictError,
  OpeningVersionConflictError,
} from "typespec/problem/orgs/openings";
import {
  PipelineStageInUseError,
  PipelineTemplateNameTakenError,
  PipelineTemplateNotFoundError,
} from "typespec/problem/orgs/pipelines";
import { APIError, getProblemType } from "../../api/client";

export type PipelineProblem =
  | { kind: "stage-in-use" }
  | { kind: "name-taken" }
  | { kind: "template-not-found" }
  | { kind: "template-limit"; limit: number }
  | { kind: "version-conflict" }
  | { kind: "opening-unavailable" }
  | { kind: "unknown-stage" }
  | { kind: "other"; error: unknown };

export function pipelineProblem(error: unknown): PipelineProblem {
  const type = getProblemType(error);
  if (type === PipelineStageInUseError.type) return { kind: "stage-in-use" };
  if (type === PipelineTemplateNameTakenError.type)
    return { kind: "name-taken" };
  if (type === PipelineTemplateNotFoundError.type)
    return { kind: "template-not-found" };
  if (type === "vetchium-problem-details/org-pipeline-template-limit-reached") {
    const limit =
      error instanceof APIError
        ? Reflect.get(error.problem ?? {}, "limit")
        : undefined;
    if (typeof limit === "number") return { kind: "template-limit", limit };
  }
  if (type === OpeningVersionConflictError.type)
    return { kind: "version-conflict" };
  if (type === OpeningStateConflictError.type)
    return { kind: "opening-unavailable" };
  if (
    type === ValidationFailedError.type &&
    error instanceof APIError &&
    error.problem?.fields?.some((field) => /^stages\.\d+\.id$/.test(field))
  )
    return { kind: "unknown-stage" };
  return { kind: "other", error };
}
