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

const maxLogoDeletionBatchSize = 100

// LogoStore removes the bytes of an Org logo. Deletion is idempotent.
type LogoStore interface {
	DeleteLogo(context.Context, pgtype.UUID) error
}

type logoDeletionQueries interface {
	QueueExpiredOrgLogoUploads(context.Context, string) (int32, error)
	ClaimOrgLogoDeletion(context.Context, pgtype.UUID) (
		sqlc.ClaimOrgLogoDeletionRow, error,
	)
	RetryOrgLogoDeletion(context.Context, sqlc.RetryOrgLogoDeletionParams) (int64, error)
	CompleteOrgLogoDeletion(context.Context, sqlc.CompleteOrgLogoDeletionParams) (
		pgtype.UUID, error,
	)
}

// EnableOrgLogoDeletion removes the bytes of every logo the database no
// longer references: removed, replaced, abandoned mid-upload, or dropped with
// a plan below Silver. The database reference is gone at once; this retries
// until the object store confirms.
func (w *Worker) EnableOrgLogoDeletion(store LogoStore) {
	w.logoStore = store
	w.jobs = append(w.jobs, periodicJob{
		name: "delete-org-logos", interval: w.pictureDeletionInterval,
		run: w.deleteOrgLogos,
	})
}

func (w *Worker) deleteOrgLogos(ctx context.Context) error {
	if _, err := w.logoQueries.QueueExpiredOrgLogoUploads(ctx, w.tenantID); err != nil {
		return fmt.Errorf("queue expired Org logo uploads: %w", err)
	}
	for range maxLogoDeletionBatchSize {
		leaseToken, err := dbvalue.NewUUID()
		if err != nil {
			return err
		}
		row, err := w.logoQueries.ClaimOrgLogoDeletion(ctx, leaseToken)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("claim Org logo deletion: %w", err)
		}
		deleteCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		deleteErr := w.logoStore.DeleteLogo(deleteCtx, row.ObjectID)
		cancel()
		if deleteErr != nil {
			w.log.Warn("Org logo object deletion failed",
				"event", "org_logo_delete_retry",
				"objectID", dbvalue.FormatUUID(row.ObjectID))
			updated, err := w.logoQueries.RetryOrgLogoDeletion(
				ctx, sqlc.RetryOrgLogoDeletionParams{
					ObjectID: row.ObjectID, LeaseToken: leaseToken,
					LastError: "object-store deletion failed",
				},
			)
			if err != nil {
				return fmt.Errorf("retry Org logo deletion: %w", err)
			}
			if updated != 1 {
				return fmt.Errorf("logo deletion lease was lost")
			}
			continue
		}
		if _, err := w.logoQueries.CompleteOrgLogoDeletion(ctx,
			sqlc.CompleteOrgLogoDeletionParams{
				ObjectID: row.ObjectID, LeaseToken: leaseToken,
				TenantID: w.tenantID,
			}); err != nil {
			return fmt.Errorf("complete Org logo deletion: %w", err)
		}
	}
	return nil
}
