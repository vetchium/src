/** A price in the currency's minor unit, formatted for the reader. */
export function formatPrice(
  locale: string,
  currency: string,
  amountMinor: number,
): string {
  const format = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amountMinor / 10 ** digits);
}
