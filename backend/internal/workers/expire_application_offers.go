package workers

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	federationspec "github.com/vetchium/src/typespec/federation"

	"backend/internal/db/sqlc"
	"backend/internal/hubapplications"
)

const maxOfferExpiryBatches = 10

// expireApplicationOffers moves every offered application whose offer passed
// its deadline to offer_declined (HP-STA table: the deadline passes). Each
// batch commits once: the lock, the guarded statement with history and
// audit, and the applicants' projection events.
func (w *Worker) expireApplicationOffers(ctx context.Context) error {
	for range maxOfferExpiryBatches {
		expired, err := expireOfferBatch(ctx, w.offerExpiryDB, w.tenantID)
		if err != nil {
			return fmt.Errorf("expire application offers: %w", err)
		}
		if expired > 0 {
			w.log.Info("application offers expired", "count", expired)
		}
		if expired == 0 {
			return nil
		}
	}
	return nil
}

func expireOfferBatch(
	ctx context.Context, db *pgxpool.Pool, tenantID string,
) (int, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	due, err := q.LockDueOrgApplicationOffers(ctx)
	if err != nil || len(due) == 0 {
		return 0, err
	}
	rows, err := q.ExpireOrgApplicationOffers(ctx,
		sqlc.ExpireOrgApplicationOffersParams{
			ApplicationIds: due, TenantID: tenantID,
		})
	if err != nil {
		return 0, err
	}
	ids := make([]pgtype.UUID, 0, len(rows))
	for _, row := range rows {
		count := int64(len(rows))
		if row.ExpiredRows != count || row.HistoryRows != count ||
			row.AuditRows != count {
			return 0, fmt.Errorf("incomplete offer expiry")
		}
		ids = append(ids, row.OrgApplicationID)
	}
	if len(ids) > 0 {
		if err := hubapplications.EnqueueNotifiedChanges(
			ctx, q, ids, federationspec.NoticeOfferExpired,
		); err != nil {
			return 0, err
		}
	}
	return len(ids), tx.Commit(ctx)
}
