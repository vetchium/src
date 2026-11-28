package workers

import (
	"context"
	"fmt"

	"backend/internal/db/sqlc"
)

const (
	hubPendingReplyBatchSize  = 100
	maxHubPendingReplyBatches = 10
)

// reapHubPendingReplies deletes pending reply texts whose operation is past
// its expiry, with the audit events in the same transaction (PST-RPL-009).
func (w *Worker) reapHubPendingReplies(ctx context.Context) error {
	total := 0
	for range maxHubPendingReplyBatches {
		reaped, err := w.reapHubPendingReplyBatch(ctx)
		if err != nil {
			return fmt.Errorf("reap pending Hub replies: %w", err)
		}
		total += reaped
		if reaped < hubPendingReplyBatchSize {
			break
		}
	}
	if total > 0 {
		w.log.Info("pending Hub replies reaped",
			"event", "hub_pending_replies_reaped", "count", total)
	}
	return nil
}

func (w *Worker) reapHubPendingReplyBatch(ctx context.Context) (int, error) {
	tx, err := w.hubPostDB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	expired, err := q.ListExpiredPendingHubReplyTexts(ctx, hubPendingReplyBatchSize)
	if err != nil || len(expired) == 0 {
		return 0, err
	}
	ids := make([]string, len(expired))
	for index, row := range expired {
		ids[index] = row.ReplyID
	}
	deleted, err := q.DeleteHubReplyTextsByIDs(ctx,
		sqlc.DeleteHubReplyTextsByIDsParams{ReplyIds: ids, TenantID: w.tenantID})
	if err != nil {
		return 0, err
	}
	if deleted.AuditRows != deleted.DeletedRows {
		return 0, fmt.Errorf("incomplete pending reply audit")
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(expired), nil
}
