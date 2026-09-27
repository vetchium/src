package auth

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/handlerauth"
)

func orgCredentialLocker(userID pgtype.UUID) handlerauth.CredentialLock {
	return func(ctx context.Context, queries sqlc.Querier) error {
		_, err := queries.LockOrgUserCredentialMutation(ctx, userID)
		return err
	}
}

func lockOrgUser(
	ctx context.Context, q *sqlc.Queries, userID pgtype.UUID,
) error {
	_, err := q.LockOrgUserCredentialMutation(ctx, userID)
	return err
}
