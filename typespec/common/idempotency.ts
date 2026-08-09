export type IdempotencyKey = string;

export function isIdempotencyKey(value: IdempotencyKey): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._~-]{21,127}$/.test(value);
}
