import type { StageKind } from "../hiring/vocabulary.ts";

export const capabilityValues = [
  "sourcing",
  "interviewing",
  "assessment",
  "background_check",
] as const;

export type Capability = (typeof capabilityValues)[number];

export const Sourcing: Capability = "sourcing";
export const Interviewing: Capability = "interviewing";
export const Assessment: Capability = "assessment";
export const BackgroundCheck: Capability = "background_check";

const capabilities = new Set<string>(capabilityValues);

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && capabilities.has(value);
}

const stageKinds: Readonly<Partial<Record<Capability, StageKind>>> = {
  interviewing: "interview",
  assessment: "assessment",
  background_check: "background_check",
};

/**
 * The stage kind a stage Capability performs. Sourcing and an unknown
 * Capability perform none. `review` stages have no Capability: they are
 * in-house only.
 */
export function capabilityStageKind(value: unknown): StageKind | undefined {
  return isCapability(value) ? stageKinds[value] : undefined;
}
