import type { AICreditBalance } from "typespec/orgs/ai/types";

/** The share of credits used from which the portal warns. */
export const creditWarningShare = 0.8;

export type CreditUseLevel = "normal" | "warning" | "exhausted";

export interface CreditUse {
  used: number;
  left: number;
  total: number;
  /** Whole percent, rounded down so a gauge never shows 100 early. */
  percent: number;
  level: CreditUseLevel;
}

/** How much of `total` is gone when `left` remains; undefined without any. */
export function creditUse(total: number, left: number): CreditUse | undefined {
  if (total <= 0) return undefined;
  const remaining = Math.min(Math.max(left, 0), total);
  const used = total - remaining;
  const level: CreditUseLevel =
    remaining === 0
      ? "exhausted"
      : used >= total * creditWarningShare
        ? "warning"
        : "normal";
  return {
    used,
    left: remaining,
    total,
    percent: Math.floor((used * 100) / total),
    level,
  };
}

/** Every usable credit together; credits held by calls in flight count as
 * used, since a new call cannot spend them. */
export function overallCreditUse(
  balance: AICreditBalance,
): CreditUse | undefined {
  return creditUse(
    balance.monthly_grant_total + balance.purchased_total,
    balance.available,
  );
}
