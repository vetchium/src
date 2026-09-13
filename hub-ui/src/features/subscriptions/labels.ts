import type { TFunction } from "i18next";
import { isHubPlan } from "typespec/hub/subscriptions/plans";

/**
 * Returns the translated plan name for a plan this contract version defines,
 * and the raw OID otherwise, so an unrecognized plan still shows something
 * meaningful.
 */
export function planLabel(t: TFunction, planOID: string): string {
  if (isHubPlan(planOID)) {
    return t(`plans.names.${planOID}`);
  }
  return planOID;
}
