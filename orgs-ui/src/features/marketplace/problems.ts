import { APIError, getProblemType } from "../../api/client";

export type MarketplaceProblem =
  | { kind: "listing-plan-required" }
  | { kind: "listing-not-found" }
  | { kind: "listing-not-available" }
  | { kind: "tenant-unavailable" }
  | { kind: "engagement-self" }
  | { kind: "engagement-exists" }
  | { kind: "engagement-not-found" }
  | { kind: "engagement-state-conflict" }
  | { kind: "engagement-version-conflict" }
  | { kind: "assignment-exists" }
  | { kind: "assignment-not-found" }
  | { kind: "assignment-limit-reached"; limit?: number }
  | { kind: "capability-mismatch" }
  | { kind: "other"; error: unknown };

export function marketplaceProblem(error: unknown): MarketplaceProblem {
  const type = getProblemType(error);
  const problem = error instanceof APIError ? error.problem : undefined;
  if (type === "vetchium-problem-details/org-listing-plan-required") {
    return { kind: "listing-plan-required" };
  }
  if (type === "vetchium-problem-details/org-listing-not-found") {
    return { kind: "listing-not-found" };
  }
  if (type === "vetchium-problem-details/org-listing-not-available") {
    return { kind: "listing-not-available" };
  }
  if (type === "vetchium-problem-details/org-tenant-unavailable") {
    return { kind: "tenant-unavailable" };
  }
  if (type === "vetchium-problem-details/org-engagement-self") {
    return { kind: "engagement-self" };
  }
  if (type === "vetchium-problem-details/org-engagement-exists") {
    return { kind: "engagement-exists" };
  }
  if (type === "vetchium-problem-details/org-engagement-not-found") {
    return { kind: "engagement-not-found" };
  }
  if (type === "vetchium-problem-details/org-engagement-state-conflict") {
    return { kind: "engagement-state-conflict" };
  }
  if (type === "vetchium-problem-details/org-engagement-version-conflict") {
    return { kind: "engagement-version-conflict" };
  }
  if (type === "vetchium-problem-details/org-assignment-exists") {
    return { kind: "assignment-exists" };
  }
  if (type === "vetchium-problem-details/org-assignment-not-found") {
    return { kind: "assignment-not-found" };
  }
  if (type === "vetchium-problem-details/org-assignment-limit-reached") {
    const limit = Reflect.get(problem ?? {}, "limit");
    return {
      kind: "assignment-limit-reached",
      limit: typeof limit === "number" ? limit : undefined,
    };
  }
  if (type === "vetchium-problem-details/org-engagement-capability-mismatch") {
    return { kind: "capability-mismatch" };
  }
  return { kind: "other", error };
}
