package problem

type RetryAfterSeconds int32

var RateLimitExceededError = Details{
	Type:   "vetchium-problem-details/rate-limit-exceeded",
	Title:  "Rate limit exceeded",
	Status: 429,
	Detail: "Too many requests have been made",
}

var InvalidPaginationKeyError = Details{
	Type:   "vetchium-problem-details/invalid-pagination-key",
	Title:  "Invalid pagination key",
	Status: 400,
	Detail: "Pagination key is invalid for this request",
}

var IdempotencyKeyConflictError = Details{
	Type:   "vetchium-problem-details/idempotency-key-conflict",
	Title:  "Idempotency key conflict",
	Status: 409,
	Detail: "The idempotency key was already used for a different request",
}
