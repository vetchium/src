import type { AICreditBalance } from "typespec/orgs/ai/types";

/** The share of usable credits from which the portal warns. */
export const creditWarningShare = 0.8;

export type CreditUseLevel = "normal" | "warning" | "exhausted";

export interface CreditUse {
  used: number;
  total: number;
  /** Whole percent, rounded down so the gauge never shows 100 early. */
  percent: number;
  level: CreditUseLevel;
}

/** How much of the usable credits is spent or held; undefined without any. */
export function creditUse(balance: AICreditBalance): CreditUse | undefined {
  const total = balance.usable_total;
  if (total <= 0) return undefined;
  const used = Math.min(Math.max(total - balance.available, 0), total);
  const level: CreditUseLevel =
    balance.available <= 0
      ? "exhausted"
      : used >= total * creditWarningShare
        ? "warning"
        : "normal";
  return { used, total, percent: Math.floor((used * 100) / total), level };
}
