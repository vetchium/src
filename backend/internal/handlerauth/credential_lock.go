// Package handlerauth provides HTTP and transaction behavior shared by portal
// authentication handlers.
package handlerauth

import (
	"context"
	"net/http"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

type QueryServer interface {
	apiserver.RuntimeServer
	HandlerQueries() sqlc.Querier
}

// CredentialLock acquires the portal-specific row lock using the supplied
// transaction-scoped query interface.
type CredentialLock func(context.Context, sqlc.Querier) error

// WithCredentialLock serializes credential replacement and commits the state
// change in the same transaction that owns the row lock.
func WithCredentialLock[T any](
	s QueryServer, r *http.Request, lock CredentialLock,
	work func(sqlc.Querier) (T, error),
) (T, error) {
	var zero T
	runtime := s.HandlerRuntime()
	// Handler unit tests use a query stub without a pool. Production servers
	// always take the transaction-scoped row-lock path below.
	if runtime.DB == nil {
		return work(s.HandlerQueries())
	}
	tx, err := runtime.DB.Begin(r.Context())
	if err != nil {
		return zero, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	queries := sqlc.New(tx)
	if err := lock(r.Context(), queries); err != nil {
		return zero, err
	}
	result, err := work(queries)
	if err != nil {
		return zero, err
	}
	if err := tx.Commit(r.Context()); err != nil {
		return zero, err
	}
	return result, nil
}
