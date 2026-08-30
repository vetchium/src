package handlerauth

import (
	"net/http"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/idempotency"
)

type IdempotencyServer interface {
	apiserver.RuntimeServer
	EncryptIdempotency([]byte) ([]byte, error)
	DecryptIdempotency([]byte) ([]byte, error)
}

type Problem = idempotency.APIProblem
type Result[T any] = idempotency.Result[T]

func IdempotencyKey(
	s IdempotencyServer, w http.ResponseWriter, r *http.Request,
) (common.IdempotencyKey, bool) {
	return idempotency.Key(s.HandlerRuntime(), w, r)
}

// Failure returns an expected problem that carries no authentication
// challenge. A 401 belongs in AuthenticationFailure instead.
func Failure[T any](details problem.Details) (Result[T], *Problem, error) {
	return Result[T]{}, &Problem{Details: details}, nil
}

// AuthenticationFailure returns a 401 together with the WWW-Authenticate
// challenge RFC 9110 requires. The replay path reproduces both.
func AuthenticationFailure[T any](
	details problem.Details, challenge string,
) (Result[T], *Problem, error) {
	return Result[T]{}, &Problem{
		Details: details, WWWAuthenticate: challenge,
	}, nil
}

func RunIdempotent[T any](
	s IdempotencyServer, w http.ResponseWriter, r *http.Request,
	operation, bindingID string, key common.IdempotencyKey,
	request any, expiresAt time.Time,
	work func(*sqlc.Queries) (Result[T], *Problem, error),
) {
	idempotency.Run(
		s.HandlerRuntime(), w, r,
		idempotency.Request{
			Operation: operation, BindingID: bindingID, Key: key,
			Payload: request, ExpiresAt: expiresAt,
		},
		idempotency.Cipher{
			Encrypt: s.EncryptIdempotency,
			Decrypt: s.DecryptIdempotency,
		},
		work,
	)
}

// LoginReplayWindow is how long a login response stays replayable for a repeat
// of the same request.
const LoginReplayWindow = 5 * time.Minute

// LoginReplayExpiresAt bounds the login replay window by the shortest session
// the portal issues. A replay record that outlived its session would hand a
// caller back a session token that no longer authenticates anything, which
// matters most under the very short session lifetimes the CI configuration
// deliberately runs with.
func LoginReplayExpiresAt(
	durations apiserver.SessionDurations, now time.Time,
) time.Time {
	expiresAt := now.Add(LoginReplayWindow)
	sessionExpiry := now.Add(durations.Shortest())
	if sessionExpiry.Before(expiresAt) {
		return sessionExpiry
	}
	return expiresAt
}
