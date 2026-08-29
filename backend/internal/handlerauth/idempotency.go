package handlerauth

import (
	"net/http"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/db/sqlc"
	"backend/internal/idempotency"
)

type IdempotencyServer interface {
	RuntimeServer
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

func Failure[T any](
	details problem.Details, wwwAuthenticate ...string,
) (Result[T], *Problem, error) {
	challenge := ""
	if len(wwwAuthenticate) != 0 {
		challenge = wwwAuthenticate[0]
	}
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
