import type { TFunction } from "i18next";
import type {
  AssessmentOutcome,
  CheckOutcome,
} from "typespec/orgs/applications/applications";
import type { CheckType } from "typespec/orgs/hiring/vocabulary";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import type { EngagementState } from "typespec/orgs/marketplace/engagements";
import type { ListingState } from "typespec/orgs/marketplace/listings";
import type { BillableFactKind } from "typespec/orgs/marketplace/statements";
import type { WorkStatus } from "typespec/orgs/marketplace/work/work";

export const capabilityColors: Record<Capability, string> = {
  sourcing: "purple",
  interviewing: "cyan",
  assessment: "orange",
  background_check: "green",
};

export function capabilityLabel(t: TFunction, capability: Capability): string {
  return t(`marketplace.capabilities.${capability}`, {
    defaultValue: capability,
  });
}

export const engagementStateColors: Record<EngagementState, string> = {
  proposed: "gold",
  active: "success",
  ended: "default",
  declined: "error",
  withdrawn: "default",
  expired: "default",
};

export function engagementStateLabel(
  t: TFunction,
  state: EngagementState,
): string {
  return t(`marketplace.engagementStates.${state}`, { defaultValue: state });
}

export const listingStateColors: Record<ListingState, string> = {
  draft: "blue",
  listed: "success",
  unlisted: "default",
};

export function listingStateLabel(t: TFunction, state: ListingState): string {
  return t(`marketplace.listingStates.${state}`, { defaultValue: state });
}

export const workStatusColors: Record<WorkStatus, string> = {
  pending: "default",
  scheduled: "cyan",
  awaiting_consent: "gold",
  in_progress: "processing",
  completed: "success",
};

export function workStatusLabel(t: TFunction, status: WorkStatus): string {
  return t(`marketplace.workStatuses.${status}`, { defaultValue: status });
}

export const factColors: Record<BillableFactKind, string> = {
  joined: "blue",
  separated: "default",
  interview_completed: "cyan",
  interview_no_show: "volcano",
  assessment_result: "orange",
  background_check_outcome: "green",
};

export function factLabel(t: TFunction, fact: BillableFactKind): string {
  return t(`marketplace.facts.${fact}`, { defaultValue: fact });
}

export function checkTypeLabel(t: TFunction, type: CheckType): string {
  return t(`applications.work.checkTypes.${type}`, { defaultValue: type });
}

export function checkOutcomeLabel(t: TFunction, outcome: CheckOutcome): string {
  return t(`applications.work.checkOutcomes.${outcome}`, {
    defaultValue: outcome,
  });
}

export function assessmentOutcomeLabel(
  t: TFunction,
  outcome: AssessmentOutcome,
): string {
  return t(`applications.assessment.outcomes.${outcome}`, {
    defaultValue: outcome,
  });
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts[parts.length - 1]?.charAt(0) ?? "";
  if (parts.length === 0) return "C";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "C";
  return (first + last).toUpperCase();
}

export const openingStateColors: Record<string, string> = {
  published: "success",
  paused: "warning",
  closed: "default",
  expired: "default",
};

export function openingStateLabel(t: TFunction, state: string): string {
  return t(`openings.states.${state}`, { defaultValue: state });
}

export const referralRouteColors: Record<string, string> = {
  suggested: "purple",
  declared: "default",
};

export function referralRouteLabel(t: TFunction, route: string): string {
  return t(`marketplace.routes.${route}`, { defaultValue: route });
}

export const hubStatusColors: Record<string, string> = {
  applied: "processing",
  in_review: "cyan",
  interviewing: "purple",
  offer: "gold",
  hired: "success",
  not_progressing: "default",
  withdrawn: "default",
};

export function hubStatusLabel(t: TFunction, status: string): string {
  return t(`applications.statuses.${status}`, { defaultValue: status });
}
