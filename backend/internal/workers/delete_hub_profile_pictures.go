package workers

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

const maxPictureDeletionBatchSize = 100

type PictureStore interface {
	Delete(context.Context, pgtype.UUID) error
}

type pictureDeletionQueries interface {
	QueueExpiredHubProfilePictureUploads(context.Context, string) (int32, error)
	ClaimHubProfilePictureDeletion(context.Context,
		sqlc.ClaimHubProfilePictureDeletionParams) (
		sqlc.ClaimHubProfilePictureDeletionRow, error,
	)
	RetryHubProfilePictureDeletion(context.Context,
		sqlc.RetryHubProfilePictureDeletionParams) (int64, error)
	CompleteHubProfilePictureDeletion(context.Context,
		sqlc.CompleteHubProfilePictureDeletionParams) (pgtype.UUID, error)
}

func (w *Worker) deleteHubProfilePictures(ctx context.Context) error {
	if _, err := w.pictureQueries.QueueExpiredHubProfilePictureUploads(ctx, w.tenantID); err != nil {
		return fmt.Errorf("queue expired profile-picture uploads: %w", err)
	}
	for range maxPictureDeletionBatchSize {
		leaseToken, err := dbvalue.NewUUID()
		if err != nil {
			return err
		}
		row, err := w.pictureQueries.ClaimHubProfilePictureDeletion(ctx,
			sqlc.ClaimHubProfilePictureDeletionParams{
				LeaseToken: leaseToken, TenantID: w.tenantID,
			})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("claim profile-picture deletion: %w", err)
		}
		deleteCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		deleteErr := w.pictureStore.Delete(deleteCtx, row.ObjectID)
		cancel()
		if deleteErr != nil {
			w.log.Warn("profile-picture object deletion failed",
				"event", "profile_picture_delete_retry",
				"objectID", dbvalue.FormatUUID(row.ObjectID))
			updated, err := w.pictureQueries.RetryHubProfilePictureDeletion(
				ctx, sqlc.RetryHubProfilePictureDeletionParams{
					ObjectID: row.ObjectID, LeaseToken: leaseToken,
					LastError: "object-store deletion failed",
					TenantID:  w.tenantID,
				},
			)
			if err != nil {
				return fmt.Errorf("retry profile-picture deletion: %w", err)
			}
			if updated != 1 {
				return fmt.Errorf("profile-picture deletion lease was lost")
			}
			continue
		}
		_, err = w.pictureQueries.CompleteHubProfilePictureDeletion(ctx,
			sqlc.CompleteHubProfilePictureDeletionParams{
				ObjectID: row.ObjectID, LeaseToken: leaseToken,
				TenantID: w.tenantID,
			})
		if err != nil {
			return fmt.Errorf("complete profile-picture deletion: %w", err)
		}
	}
	return nil
}
