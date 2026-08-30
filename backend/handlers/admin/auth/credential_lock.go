package auth

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/handlerauth"
)

type adminCredentialLock struct {
	userID       pgtype.UUID
	emailAddress string
}

func adminCredentialLocker(
	identity adminCredentialLock,
) handlerauth.CredentialLock {
	return func(ctx context.Context, queries sqlc.Querier) error {
		if identity.emailAddress != "" {
			_, err := queries.LockAdminEmailCredentialMutation(
				ctx, identity.emailAddress,
			)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		_, err := queries.LockAdminUserCredentialMutation(ctx, identity.userID)
		return err
	}
}
