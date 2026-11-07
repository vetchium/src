package workers

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/agencycontacts"
	"backend/internal/db/sqlc"
)

const (
	chatRequestExpiryBatchSize  = 100
	maxChatRequestExpiryBatches = 10
	// chatRequestLifetime is how long a request waits for an answer
	// (MKT-REQ-009).
	chatRequestLifetime = 14 * 24 * time.Hour
)

// contactChange is a Contact whose pointer an expiry or a lifted block
// changed.
type contactChange struct {
	orgDID, contactID pgtype.UUID
}

// expireChatRequests expires requests left unanswered past their lifetime
// with no block (MKT-REQ-009), deletes `sender` blocks that have lifted
// (MKT-REQ-012), and forgets past daily request counts (MKT-REQ-006). Each
// batch commits once with its audit events and pointer events.
func (w *Worker) expireChatRequests(ctx context.Context) error {
	cutoff := time.Now().UTC().Add(-chatRequestLifetime)
	for _, step := range []struct {
		name string
		run  func(*sqlc.Queries) ([]contactChange, error)
	}{
		{"expire chat requests", func(q *sqlc.Queries) ([]contactChange, error) {
			rows, err := q.ExpirePendingChatRequests(ctx, sqlc.ExpirePendingChatRequestsParams{
				CutoffSentAt: pgtype.Timestamptz{Time: cutoff, Valid: true},
				BatchSize:    chatRequestExpiryBatchSize, TenantID: w.tenantID,
			})
			if err != nil {
				return nil, err
			}
			changes := make([]contactChange, len(rows))
			for index, row := range rows {
				if row.AuditRows != int64(len(rows)) {
					return nil, fmt.Errorf("incomplete chat request expiry")
				}
				changes[index] = contactChange{row.OrgDid, row.ContactID}
			}
			return changes, nil
		}},
		{"lift chat request blocks", func(q *sqlc.Queries) ([]contactChange, error) {
			rows, err := q.DeleteLiftedChatRequestBlocks(ctx, sqlc.DeleteLiftedChatRequestBlocksParams{
				BatchSize: chatRequestExpiryBatchSize, TenantID: w.tenantID,
			})
			if err != nil {
				return nil, err
			}
			changes := make([]contactChange, len(rows))
			for index, row := range rows {
				if row.AuditRows != int64(len(rows)) {
					return nil, fmt.Errorf("incomplete chat request block lift")
				}
				changes[index] = contactChange{row.OrgDid, row.ContactID}
			}
			return changes, nil
		}},
	} {
		total := 0
		for range maxChatRequestExpiryBatches {
			changed, err := chatRequestBatch(ctx, w.chatRequestExpiryDB, step.run)
			if err != nil {
				return fmt.Errorf("%s: %w", step.name, err)
			}
			total += changed
			if changed < chatRequestExpiryBatchSize {
				break
			}
		}
		if total > 0 {
			w.log.Info("chat requests housekept", "event", "chat_requests_housekept",
				"step", step.name, "count", total)
		}
	}

	for range maxChatRequestExpiryBatches {
		pruned, err := w.queries.PruneOrgChatRequestCreations(ctx,
			sqlc.PruneOrgChatRequestCreationsParams{
				BatchSize: chatRequestExpiryBatchSize, TenantID: w.tenantID,
			})
		if err != nil {
			return fmt.Errorf("prune agency chat request creations: %w", err)
		}
		if len(pruned) < chatRequestExpiryBatchSize {
			break
		}
	}
	for range maxChatRequestExpiryBatches {
		pruned, err := w.queries.PruneHubChatRequestCreations(ctx,
			sqlc.PruneHubChatRequestCreationsParams{
				BatchSize: chatRequestExpiryBatchSize, TenantID: w.tenantID,
			})
		if err != nil {
			return fmt.Errorf("prune Hub chat request creations: %w", err)
		}
		if len(pruned) < chatRequestExpiryBatchSize {
			break
		}
	}
	return nil
}

// chatRequestBatch runs one bounded change and syncs the pointer of every
// Contact it touched in the same transaction. It returns how many rows
// changed.
func chatRequestBatch(
	ctx context.Context, db *pgxpool.Pool,
	run func(*sqlc.Queries) ([]contactChange, error),
) (int, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	changes, err := run(q)
	if err != nil || len(changes) == 0 {
		return 0, err
	}
	synced := make(map[contactChange]bool, len(changes))
	for _, change := range changes {
		if synced[change] {
			continue
		}
		synced[change] = true
		if err := agencycontacts.SyncPointer(ctx, q, change.orgDID,
			change.contactID, agencycontacts.NoNotice); err != nil {
			return 0, err
		}
	}
	return len(changes), tx.Commit(ctx)
}
