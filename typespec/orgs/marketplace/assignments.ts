import type { PipelineStage, PipelineStageID } from "../hiring/pipelines.ts";
import { isPipelineStageID } from "../hiring/pipelines.ts";
import type { OpeningNumber } from "../openings/types.ts";
import type { Capability } from "./capabilities.ts";
import type { EngagementCounterparty, EngagementID } from "./engagements.ts";
import { isEngagementID } from "./engagements.ts";

/** Bounds the `sourcing` engagements assigned to one Opening. */
export const maxOpeningAgencies = 20;
/** Bounds the engagements assigned to one stage. */
export const maxStageProviders = 10;

/** One engagement assigned to an Opening or to one of its stages. */
export interface Assignment {
  engagement_id: EngagementID;
  /** The provider. */
  counterparty: EngagementCounterparty;
  capability: Capability;
  assigned_at: string;
}

/** The engagements assigned to one stage. */
export interface StageAssignments {
  stage: PipelineStage;
  assignments: Assignment[];
}

/** What the consumer has attached to an Opening. */
export interface OpeningProviders {
  opening_number: OpeningNumber;
  /** `sourcing` engagements assigned to the whole Opening. */
  agencies: Assignment[];
  /** Every stage in pipeline order. */
  stages: StageAssignments[];
}

/** The provider performing an application's current stage. */
export interface ApplicationRoute {
  engagement_id: EngagementID;
  provider: EngagementCounterparty;
  capability: Capability;
  routed_at: string;
}

export interface GetOpeningProvidersRequest {
  opening_number: OpeningNumber;
}

export function validateGetOpeningProvidersRequest(
  request: GetOpeningProvidersRequest,
): string[] {
  return Number.isInteger(request.opening_number) && request.opening_number >= 1
    ? []
    : ["opening_number"];
}

/**
 * Assigns a `sourcing` engagement to the Opening (no `stage_id`) or an
 * engagement of the Capability that performs the stage's kind to that stage.
 */
export interface AssignOpeningProviderRequest {
  opening_number: OpeningNumber;
  engagement_id: EngagementID;
  stage_id?: PipelineStageID;
}

export type UnassignOpeningProviderRequest = AssignOpeningProviderRequest;

export function validateAssignOpeningProviderRequest(
  request: AssignOpeningProviderRequest,
): string[] {
  const fields: string[] = [];
  if (!Number.isInteger(request.opening_number) || request.opening_number < 1)
    fields.push("opening_number");
  if (!isEngagementID(request.engagement_id)) fields.push("engagement_id");
  if (request.stage_id !== undefined && !isPipelineStageID(request.stage_id))
    fields.push("stage_id");
  return fields;
}

export const validateUnassignOpeningProviderRequest =
  validateAssignOpeningProviderRequest;
