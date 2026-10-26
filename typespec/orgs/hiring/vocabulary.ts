export const stageKindValues = [
  "review",
  "assessment",
  "interview",
  "background_check",
] as const;

export type StageKind = (typeof stageKindValues)[number];

export const ReviewStage: StageKind = "review";
export const AssessmentStage: StageKind = "assessment";
export const InterviewStage: StageKind = "interview";
export const BackgroundCheckStage: StageKind = "background_check";

export const checkTypeValues = [
  "identity",
  "education",
  "employment",
  "criminal",
  "address",
  "credit",
  "drug",
] as const;

export type CheckType = (typeof checkTypeValues)[number];

const stageKinds = new Set<string>(stageKindValues);
const checkTypes = new Set<string>(checkTypeValues);

export function isStageKind(value: unknown): value is StageKind {
  return typeof value === "string" && stageKinds.has(value);
}

export function isCheckType(value: unknown): value is CheckType {
  return typeof value === "string" && checkTypes.has(value);
}
