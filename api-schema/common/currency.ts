// Shared region→currency map (Spec 17). Prices themselves live in each portal's
// frontend config; this map only fixes the currency/symbol/exponent per region so
// all portals agree. No money is stored in the database.

export type RegionCode = "ind1" | "usa1" | "deu1" | "sgp1";

export interface RegionCurrency {
	currency_code: string; // ISO 4217
	symbol: string;
	exponent: number; // minor-unit decimal places (e.g. 2 → cents/paise)
}

export const REGION_CURRENCY: Record<RegionCode, RegionCurrency> = {
	ind1: { currency_code: "INR", symbol: "₹", exponent: 2 },
	usa1: { currency_code: "USD", symbol: "$", exponent: 2 },
	deu1: { currency_code: "EUR", symbol: "€", exponent: 2 },
	sgp1: { currency_code: "SGD", symbol: "S$", exponent: 2 },
};
