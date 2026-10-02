import type { TFunction } from "i18next";
import { isOrgPlan } from "typespec/orgs/subscriptions/plans";

/**
 * Returns the translated plan name for a plan this contract version defines,
 * and the raw OID otherwise, so an unrecognized plan still shows something
 * meaningful.
 */
export function planLabel(t: TFunction, planOID: string): string {
  return isOrgPlan(planOID) ? t(`plans.names.${planOID}`) : planOID;
}
