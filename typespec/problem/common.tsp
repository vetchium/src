import "@typespec/http";

import "./details.tsp";

using TypeSpec.Http;

namespace Vetchium.Problem;

/** A nonnegative delay in seconds carried by Retry-After. */
@minValue(0)
scalar RetryAfterSeconds extends int32;

const RateLimitExceededError = #{
  type: "vetchium-problem-details/rate-limit-exceeded",
  title: "Rate limit exceeded",
  status: 429,
  detail: "Too many requests have been made",
};

alias RateLimitExceededErrorResponse = {
  @statusCode status_code: 429;
  @header("Content-Type") content_type: "application/problem+json";
  @header("Retry-After") retry_after: RetryAfterSeconds;
  @body body: typeof RateLimitExceededError;
};

const InvalidPaginationKeyError = #{
  type: "vetchium-problem-details/invalid-pagination-key",
  title: "Invalid pagination key",
  status: 400,
  detail: "Pagination key is invalid for this request",
};

alias InvalidPaginationKeyErrorResponse = Response<
  400,
  typeof InvalidPaginationKeyError
>;

const IdempotencyKeyConflictError = #{
  type: "vetchium-problem-details/idempotency-key-conflict",
  title: "Idempotency key conflict",
  status: 409,
  detail: "The idempotency key was already used for a different request",
};

alias IdempotencyKeyConflictErrorResponse = Response<
  409,
  typeof IdempotencyKeyConflictError
>;
