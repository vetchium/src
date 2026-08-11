package admin

import (
	"net/http"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"backend/internal/idempotency"
)

type apiProblem struct {
	details         problem.Details
	wwwAuthenticate string
}

type idempotentResult[T any] struct {
	status int
	body   T
}

func idempotencyKey(
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
) (common.IdempotencyKey, bool) {
	return idempotency.Key(s.Runtime, w, r)
}

func runIdempotent[T any](
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
	operation, bindingID string, key common.IdempotencyKey,
	request any, expiresAt time.Time,
	work func(*sqlc.Queries) (idempotentResult[T], *apiProblem, error),
) {
	credentialKey := s.CredentialSubkey("idempotency")
	idempotency.Run(
		s.Runtime, w, r,
		idempotency.Request{
			Operation: operation, BindingID: bindingID, Key: key,
			Payload: request, ExpiresAt: expiresAt,
		},
		idempotency.Cipher{
			Encrypt: func(plaintext []byte) ([]byte, error) {
				return adminapi.Encrypt(credentialKey, plaintext)
			},
			Decrypt: func(ciphertext []byte) ([]byte, error) {
				return adminapi.Decrypt(credentialKey, ciphertext)
			},
		},
		func(queries *sqlc.Queries) (
			idempotency.Result[T], *idempotency.APIProblem, error,
		) {
			result, apiError, err := work(queries)
			if apiError == nil {
				return idempotency.Result[T]{
					Status: result.status, Body: result.body,
				}, nil, err
			}
			return idempotency.Result[T]{}, &idempotency.APIProblem{
				Details:         apiError.details,
				WWWAuthenticate: apiError.wwwAuthenticate,
			}, err
		},
	)
}
