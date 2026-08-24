package hub

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/hubapi"
)

type hubCredentialLock struct {
	userDID      pgtype.UUID
	emailAddress string
}

func withHubCredentialLock[T any](
	s *hubapi.Server, r *http.Request, identity hubCredentialLock,
	work func(sqlc.Querier) (T, error),
) (T, error) {
	var zero T
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
		_, err = queries.LockHubEmailCredentialMutation(
			r.Context(), identity.emailAddress,
		)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return zero, err
		}
	} else {
		_, err = queries.LockHubUserCredentialMutation(
			r.Context(), identity.userDID,
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
