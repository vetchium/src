import type { OrgPlanId } from "vetchium-specs/org/tiers";
import type { RegionCode } from "vetchium-specs/common/currency";

// Org plan pricing (Spec 17) — DISPLAY-ONLY frontend config. No DB, no payment.
// Amounts are minor units, tax-exclusive ("+ applicable taxes" shown in the UI).
// Annual = monthly × 10 ("2 months free", ~17% off). Free → "Free",
// Enterprise → "Contact us".
//
// To add a region: add backend `available_regions` row + a currency entry in
// api-schema/common/currency.ts + one entry here. No logic change.

export type PlanPrice =
	| "free"
	| "contact"
	| { monthly_minor: number; annual_minor: number };

export const ORG_PLAN_PRICING: Partial<
	Record<RegionCode, Record<OrgPlanId, PlanPrice>>
> = {
	ind1: {
		free: "free",
		silver: { monthly_minor: 499900, annual_minor: 4999000 }, // ₹4,999 / ₹49,990
		gold: { monthly_minor: 1499900, annual_minor: 14999000 }, // ₹14,999 / ₹149,990
		enterprise: "contact",
	},
	usa1: {
		free: "free",
		silver: { monthly_minor: 4900, annual_minor: 49000 }, // $49 / $490
		gold: { monthly_minor: 14900, annual_minor: 149000 }, // $149 / $1,490
		enterprise: "contact",
	},
	deu1: {
		free: "free",
		silver: { monthly_minor: 4900, annual_minor: 49000 }, // €49 / €490
		gold: { monthly_minor: 14900, annual_minor: 149000 }, // €149 / €1,490
		enterprise: "contact",
	},
};
