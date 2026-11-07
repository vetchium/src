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

/** Why the API refused a chat request, its answer, or a message. */
export type ChatRequestProblem =
  | "hub-user-not-found"
  | "contact-not-found"
  | "contact-limit-reached"
  | "requests-off"
  | "party-deleted"
  | "limit-reached"
  | "exists"
  | "blocked"
  | "not-found"
  | "conversation-open"
  | "conversation-closed";

const chatRequestProblems: Record<string, ChatRequestProblem> = {
  "vetchium-problem-details/org-hub-user-not-found": "hub-user-not-found",
  "vetchium-problem-details/org-contact-not-found": "contact-not-found",
  "vetchium-problem-details/org-contact-limit-reached": "contact-limit-reached",
  "vetchium-problem-details/org-agency-requests-off": "requests-off",
  "vetchium-problem-details/org-conversation-party-deleted": "party-deleted",
  "vetchium-problem-details/org-chat-request-limit-reached": "limit-reached",
  "vetchium-problem-details/org-chat-request-exists": "exists",
  "vetchium-problem-details/org-chat-request-blocked": "blocked",
  "vetchium-problem-details/org-chat-request-not-found": "not-found",
  "vetchium-problem-details/org-conversation-open": "conversation-open",
  "vetchium-problem-details/org-conversation-closed": "conversation-closed",
};

export function chatRequestProblem(
  error: unknown,
): ChatRequestProblem | undefined {
  const type = getProblemType(error);
  return type === undefined ? undefined : chatRequestProblems[type];
}
