import type { HubPlanId } from "vetchium-specs/hub/plans";
import type { RegionCode } from "vetchium-specs/common/currency";

// Hub plan pricing (Spec 17) — DISPLAY-ONLY frontend config. No DB, no payment.
// Amounts are minor units (e.g. paise/cents), tax-exclusive ("+ applicable taxes"
// shown in the UI). Annual = monthly × 10 ("2 months free", ~17% off).
//
// To add a region: add backend `available_regions` row + a currency entry in
// api-schema/common/currency.ts + one entry here. No logic change.

export type PlanPrice =
	| "free"
	| "contact"
	| { monthly_minor: number; annual_minor: number };

export const HUB_PLAN_PRICING: Partial<
	Record<RegionCode, Record<HubPlanId, PlanPrice>>
> = {
	ind1: {
		free: "free",
		pro: { monthly_minor: 39900, annual_minor: 399000 }, // ₹399 / ₹3,990
	},
	usa1: {
		free: "free",
		pro: { monthly_minor: 500, annual_minor: 5000 }, // $5 / $50
	},
	deu1: {
		free: "free",
		pro: { monthly_minor: 500, annual_minor: 5000 }, // €5 / €50
	},
};
