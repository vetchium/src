package hub

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/handlerauth"
)

type hubCredentialLock struct {
	userDID      pgtype.UUID
	emailAddress string
}

func hubCredentialLocker(
	identity hubCredentialLock,
) handlerauth.CredentialLock {
	return func(ctx context.Context, queries sqlc.Querier) error {
		if identity.emailAddress != "" {
			_, err := queries.LockHubEmailCredentialMutation(
				ctx, identity.emailAddress,
			)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		_, err := queries.LockHubUserCredentialMutation(ctx, identity.userDID)
		return err
	}
}
