package admin

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
)

type adminCredentialLock struct {
	userID       pgtype.UUID
	emailAddress string
}

func withAdminCredentialLock[T any](
	s *adminapi.Server, r *http.Request, identity adminCredentialLock,
	work func(sqlc.Querier) (T, error),
) (T, error) {
	var zero T
	// Handler unit tests use a query stub without a pool. Production servers
	// always take the transaction-scoped row-lock path below.
	if s.DB == nil {
		return work(s.Queries)
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		return zero, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	queries := sqlc.New(tx)
	if identity.emailAddress != "" {
		_, err = queries.LockAdminEmailCredentialMutation(
			r.Context(), identity.emailAddress,
		)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return zero, err
		}
	} else {
		_, err = queries.LockAdminUserCredentialMutation(
			r.Context(), identity.userID,
		)
		if err != nil {
			return zero, err
		}
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
