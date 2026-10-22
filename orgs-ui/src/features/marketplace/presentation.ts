import type { TFunction } from "i18next";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import type { EngagementState } from "typespec/orgs/marketplace/engagements";
import type { BillableFactKind } from "typespec/orgs/marketplace/statements";

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
