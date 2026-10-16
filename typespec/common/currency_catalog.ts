import codes from "./currency_catalog.json" with { type: "json" };

export type CurrencyCode = string;

export const currencyCatalog: readonly CurrencyCode[] = codes;
const currencyCatalogSet = new Set<string>(currencyCatalog);

export function isCurrencyCode(value: CurrencyCode): boolean {
  return currencyCatalogSet.has(value);
}
