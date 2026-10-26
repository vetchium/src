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

const maxOfferLetterDeletionBatchSize = 100

// OfferLetterStore removes the bytes of an offer letter. Deletion is
// idempotent.
type OfferLetterStore interface {
	DeleteOfferLetter(context.Context, pgtype.UUID) error
}

type offerLetterDeletionQueries interface {
	QueueExpiredOrgOfferLetters(context.Context, string) (int32, error)
	ClaimOrgOfferLetterDeletion(context.Context,
		sqlc.ClaimOrgOfferLetterDeletionParams) (
		sqlc.ClaimOrgOfferLetterDeletionRow, error,
	)
	RetryOrgOfferLetterDeletion(context.Context,
		sqlc.RetryOrgOfferLetterDeletionParams) (int64, error)
	CompleteOrgOfferLetterDeletion(context.Context,
		sqlc.CompleteOrgOfferLetterDeletionParams) (pgtype.UUID, error)
}

// EnableOfferLetterDeletion removes the bytes of every offer letter no offer
// claimed: superseded by a newer upload, or unclaimed past its window. The
// database reference is gone at once; this retries until the object store
// confirms.
func (w *Worker) EnableOfferLetterDeletion(store OfferLetterStore) {
	w.offerLetterStore = store
	w.jobs = append(w.jobs, periodicJob{
		name: "delete-offer-letters", interval: w.pictureDeletionInterval,
		run: w.deleteOfferLetters,
	})
}

func (w *Worker) deleteOfferLetters(ctx context.Context) error {
	if _, err := w.offerLetterQueries.QueueExpiredOrgOfferLetters(
		ctx, w.tenantID,
	); err != nil {
		return fmt.Errorf("queue expired offer letters: %w", err)
	}
	for range maxOfferLetterDeletionBatchSize {
		leaseToken, err := dbvalue.NewUUID()
		if err != nil {
			return err
		}
		row, err := w.offerLetterQueries.ClaimOrgOfferLetterDeletion(ctx,
			sqlc.ClaimOrgOfferLetterDeletionParams{
				LeaseToken: leaseToken, TenantID: w.tenantID,
			})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("claim offer letter deletion: %w", err)
		}
		deleteCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		deleteErr := w.offerLetterStore.DeleteOfferLetter(deleteCtx, row.ObjectID)
		cancel()
		if deleteErr != nil {
			w.log.Warn("offer letter object deletion failed",
				"event", "offer_letter_delete_retry",
				"objectID", dbvalue.FormatUUID(row.ObjectID))
			updated, err := w.offerLetterQueries.RetryOrgOfferLetterDeletion(
				ctx, sqlc.RetryOrgOfferLetterDeletionParams{
					ObjectID: row.ObjectID, LeaseToken: leaseToken,
					LastError: "object-store deletion failed",
					TenantID:  w.tenantID,
				},
			)
			if err != nil {
				return fmt.Errorf("retry offer letter deletion: %w", err)
			}
			if updated != 1 {
				return fmt.Errorf("offer letter deletion lease was lost")
			}
			continue
		}
		if _, err := w.offerLetterQueries.CompleteOrgOfferLetterDeletion(ctx,
			sqlc.CompleteOrgOfferLetterDeletionParams{
				ObjectID: row.ObjectID, LeaseToken: leaseToken,
				TenantID: w.tenantID,
			}); err != nil {
			return fmt.Errorf("complete offer letter deletion: %w", err)
		}
	}
	return nil
}
