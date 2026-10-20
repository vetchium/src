package workers

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/agencycontacts"
	"backend/internal/db/sqlc"
)

const (
	contactRetentionBatchSize  = 100
	maxContactRetentionBatches = 10
)

// retainOrgContacts removes Contacts whose retention period passed (MKT-CON-004)
// and forgets past daily creation counts no longer read (MKT-CON-005).
func (w *Worker) retainOrgContacts(ctx context.Context) error {
	removed := 0
	for range maxContactRetentionBatches {
		ids, err := w.queries.ListOrgContactsDueForRetention(
			ctx, contactRetentionBatchSize)
		if err != nil {
			return fmt.Errorf("list contacts due for retention: %w", err)
		}
		for _, id := range ids {
			done, err := retainContact(ctx, w.contactRetentionDB, w.tenantID, id)
			if err != nil {
				return fmt.Errorf("retain contact: %w", err)
			}
			if done {
				removed++
			}
		}
		if len(ids) < contactRetentionBatchSize {
			break
		}
	}
	if removed > 0 {
		w.log.Info("contacts removed", "event", "contacts_retained",
			"count", removed)
	}

	for range maxContactRetentionBatches {
		pruned, err := w.queries.PruneOrgContactCreations(ctx, sqlc.PruneOrgContactCreationsParams{
			BatchSize: contactRetentionBatchSize,
			TenantID:  w.tenantID,
		})
		if err != nil {
			return fmt.Errorf("prune contact creations: %w", err)
		}
		if len(pruned) < contactRetentionBatchSize {
			break
		}
	}
	return nil
}

// retainContact deletes one Contact with its notes once its retention period has
// passed, enqueuing its pointer removal to the Hub tenant in the same transaction.
// It reports false when the Contact is no longer due, which a concurrent run or
// activity may cause.
func retainContact(
	ctx context.Context, db *pgxpool.Pool, tenantID string, id pgtype.UUID,
) (bool, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	row, err := q.RetainOrgContact(ctx, sqlc.RetainOrgContactParams{
		ContactID: id, TenantID: tenantID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if row.AuditRows != 1 {
		return false, fmt.Errorf("incomplete contact retention")
	}
	if err := agencycontacts.EnqueuePointer(ctx, q, agencycontacts.Pointer{
		ContactID: row.ContactID, OrgDID: row.OrgDid,
		HubUserDID: row.HubUserDid, Version: row.PointerVersion + 1,
		Present: false,
	}); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
