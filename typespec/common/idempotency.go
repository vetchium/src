package common

import "regexp"

type IdempotencyKey string

var idempotencyKeyPattern = regexp.MustCompile(
	`^[A-Za-z0-9][A-Za-z0-9._~-]{21,127}$`,
)

func IsIdempotencyKey(value IdempotencyKey) bool {
	return idempotencyKeyPattern.MatchString(string(value))
}
