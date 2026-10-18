import type { Details } from "../details.ts";

export const AIUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/org-ai-unavailable",
  title: "AI unavailable",
  status: 404,
  detail: "This region offers no AI models",
};

export const AINotEnabledError: Readonly<Details> = {
  type: "vetchium-problem-details/org-ai-not-enabled",
  title: "AI not enabled",
  status: 409,
  detail:
    "AI assistance is off for this organization, or its current AI terms are not accepted",
};

export const AIOperationOffError: Readonly<Details> = {
  type: "vetchium-problem-details/org-ai-operation-off",
  title: "AI operation off",
  status: 409,
  detail: "The organization allows no model for this AI operation",
};

export interface AITermsRequiredDetails extends Details {
  type: "vetchium-problem-details/org-ai-terms-required";
  terms_version: string;
}

export const AITermsRequiredErrorType =
  "vetchium-problem-details/org-ai-terms-required";

export interface AIModelNotOfferedDetails extends Details {
  type: "vetchium-problem-details/org-ai-model-not-offered";
  model_oids: string[];
}

export const AIModelNotOfferedErrorType =
  "vetchium-problem-details/org-ai-model-not-offered";

export function isAIModelNotOfferedProblem(
  value: unknown,
): value is AIModelNotOfferedDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === AIModelNotOfferedErrorType &&
    Array.isArray((value as { model_oids?: unknown }).model_oids)
  );
}

export const AIModelNotAllowedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-ai-model-not-allowed",
  title: "AI model not allowed",
  status: 422,
  detail: "The organization does not allow that model for this AI operation",
};

export interface AICreditsInsufficientDetails extends Details {
  type: "vetchium-problem-details/org-ai-credits-insufficient";
  required: number;
  available: number;
}

export const AICreditsInsufficientErrorType =
  "vetchium-problem-details/org-ai-credits-insufficient";

export function isAICreditsInsufficientProblem(
  value: unknown,
): value is AICreditsInsufficientDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === AICreditsInsufficientErrorType &&
    typeof (value as { required?: unknown }).required === "number" &&
    typeof (value as { available?: unknown }).available === "number"
  );
}

export const AIRequestInProgressError: Readonly<Details> = {
  type: "vetchium-problem-details/org-ai-request-in-progress",
  title: "AI request in progress",
  status: 409,
  detail: "A request with this idempotency key is still running",
};

export const AIModelFailedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-ai-model-failed",
  title: "AI model failed",
  status: 503,
  detail: "The AI model did not answer. No credits were charged.",
};

export const AIOutputUnusableError: Readonly<Details> = {
  type: "vetchium-problem-details/org-ai-output-unusable",
  title: "AI output unusable",
  status: 502,
  detail: "The AI model's answer could not be used. No credits were charged.",
};

export const AIPackNotOfferedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-ai-pack-not-offered",
  title: "AI credit pack not offered",
  status: 422,
  detail: "This region does not offer that AI credit pack",
};

export const AIUsageNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-ai-usage-not-found",
  title: "AI usage not found",
  status: 404,
  detail: "No readable AI usage text has that identifier",
};
