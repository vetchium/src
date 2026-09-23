/** PROF-ADR-002: the canonical profile URL is always handle-based. An alias is
 * a convenience alternate that may be released at any time. */
export function canonicalProfileURL(handle: string): string {
  return `https://vetchium.com/u/${handle}`;
}

export function aliasProfileURL(alias: string): string {
  return `https://vetchium.com/u/${alias}`;
}
