import {
	REGION_CURRENCY,
	type RegionCode,
} from "vetchium-specs/common/currency";

// Formats a minor-unit integer amount in the given region's currency, localized
// to the active i18n locale (Spec 17). Mirrors dateFormat.ts — never call
// Intl/toLocale* directly in components.
export function formatCurrency(
	amountMinor: number,
	regionCode: string,
	locale: string
): string {
	const cur = REGION_CURRENCY[regionCode as RegionCode];
	if (!cur) return String(amountMinor);
	const amount = amountMinor / Math.pow(10, cur.exponent);
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency: cur.currency_code,
		minimumFractionDigits: 0,
		maximumFractionDigits: cur.exponent,
	}).format(amount);
}

// Annual savings percentage vs paying monthly × 12 (rounded).
export function annualSavingsPercent(
	monthlyMinor: number,
	annualMinor: number
): number {
	if (monthlyMinor <= 0) return 0;
	return Math.round((1 - annualMinor / (monthlyMinor * 12)) * 100);
}
