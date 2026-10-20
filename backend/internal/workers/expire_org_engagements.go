package workers

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/db/sqlc"
	"backend/internal/engagements"
)

const (
	engagementExpiryBatchSize  = 100
	maxEngagementExpiryBatches = 10
)

// expireOrgEngagements moves every proposal that waited past its deadline to
// expired (MKT-ENG table: 30 days pass). Each batch commits once: the lock,
// the guarded statement with its audit events, and the providers' projection
// events.
func (w *Worker) expireOrgEngagements(ctx context.Context) error {
	for range maxEngagementExpiryBatches {
		expired, err := expireEngagementBatch(ctx, w.engagementExpiryDB, w.tenantID)
		if err != nil {
			return fmt.Errorf("expire Org engagements: %w", err)
		}
		if expired > 0 {
			w.log.Info("Org engagements expired", "count", expired)
		}
		if expired < engagementExpiryBatchSize {
			return nil
		}
	}
	return nil
}

func expireEngagementBatch(
	ctx context.Context, db *pgxpool.Pool, tenantID string,
) (int, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	due, err := q.LockDueOrgEngagements(ctx, engagementExpiryBatchSize)
	if err != nil || len(due) == 0 {
		return 0, err
	}
	rows, err := q.ExpireOrgEngagements(ctx, sqlc.ExpireOrgEngagementsParams{
		EngagementIds: due, TenantID: tenantID,
	})
	if err != nil {
		return 0, err
	}
	ids := make([]pgtype.UUID, 0, len(rows))
	for _, row := range rows {
		if row.AuditRows != int64(len(rows)) {
			return 0, fmt.Errorf("incomplete engagement expiry")
		}
		ids = append(ids, row.EngagementID)
	}
	if len(ids) != len(due) {
		return 0, fmt.Errorf("expired %d of %d locked engagements", len(ids), len(due))
	}
	if err := engagements.EnqueueChanges(ctx, q, ids); err != nil {
		return 0, err
	}
	return len(ids), tx.Commit(ctx)
}
