export type ShortID = string;

export interface GenerateShortIDResponse {
  short_id: ShortID;
}

export function isShortID(value: ShortID): boolean {
  return /^[0-9a-hjkmnp-tv-z]{11}$/.test(value);
}
