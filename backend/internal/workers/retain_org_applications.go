package workers

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/db/sqlc"
	"backend/internal/hubapplications"
)

const (
	retentionBatchSize  = 100
	maxRetentionBatches = 10
)

// retainApplications removes the personal data of every application whose
// retention period passed (HP-RET-001), one transaction per application.
func (w *Worker) retainApplications(ctx context.Context) error {
	removed := 0
	for range maxRetentionBatches {
		ids, err := w.queries.ListOrgApplicationsDueForRetention(
			ctx, retentionBatchSize)
		if err != nil {
			return fmt.Errorf("list applications due for retention: %w", err)
		}
		for _, id := range ids {
			done, err := retainApplication(ctx, w.applicationDB, w.tenantID, id)
			if err != nil {
				return fmt.Errorf("retain application: %w", err)
			}
			if done {
				removed++
			}
		}
		if len(ids) < retentionBatchSize {
			break
		}
	}
	if removed > 0 {
		w.log.Info("applications removed", "event", "applications_retained",
			"count", removed)
	}
	return nil
}

// retainApplication runs the state-guarded removal and enqueues the Hub
// projection's deletion in the same transaction. It reports false when the
// application is no longer due, which a concurrent run may cause.
func retainApplication(
	ctx context.Context, db *pgxpool.Pool, tenantID string, id pgtype.UUID,
) (bool, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	row, err := q.RetainOrgApplication(ctx, sqlc.RetainOrgApplicationParams{
		ApplicationID: id, TenantID: tenantID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if row.HistoryRows != 1 || row.AuditRows != 1 ||
		row.LetterRows != row.OfferRows {
		return false, fmt.Errorf("incomplete application removal")
	}
	if err := hubapplications.EnqueueRemoval(ctx, q, hubapplications.Removal{
		HubUserDID: row.HubUserDid, OrgDID: row.OrgDid,
		OpeningNumber:     row.OpeningNumber,
		ApplicationNumber: row.ApplicationNumber, Version: row.Version,
	}); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
