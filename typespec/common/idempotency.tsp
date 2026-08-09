namespace Vetchium;

/**
 * A caller-generated retry key containing at least 128 bits of cryptographic
 * randomness. It is never sufficient on its own to retrieve a stored result.
 */
@minLength(22)
@maxLength(128)
@pattern(
  "^[A-Za-z0-9][A-Za-z0-9._~-]{21,127}$",
  "Must be 22-128 URL-safe ASCII characters"
)
@format("vetchium-idempotency-key")
scalar IdempotencyKey extends string;
