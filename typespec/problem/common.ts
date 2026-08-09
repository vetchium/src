import type { Details } from "./details.ts";

export type RetryAfterSeconds = number;

export const RateLimitExceededError: Readonly<Details> = {
  type: "vetchium-problem-details/rate-limit-exceeded",
  title: "Rate limit exceeded",
  status: 429,
  detail: "Too many requests have been made",
};

export const InvalidPaginationKeyError: Readonly<Details> = {
  type: "vetchium-problem-details/invalid-pagination-key",
  title: "Invalid pagination key",
  status: 400,
  detail: "Pagination key is invalid for this request",
};

export const IdempotencyKeyConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/idempotency-key-conflict",
  title: "Idempotency key conflict",
  status: 409,
  detail: "The idempotency key was already used for a different request",
};
