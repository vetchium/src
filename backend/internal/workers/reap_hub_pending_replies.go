package workers

import (
	"context"
	"fmt"

	"backend/internal/db/sqlc"
	"backend/internal/hubreplies"
)

const (
	hubPendingReplyBatchSize  = 100
	maxHubPendingReplyBatches = 10
)

// reapHubPendingReplies deletes pending reply texts whose operation is past
// its expiry, with the audit events and a hub-reply-removed event to each
// post owner in the same transaction (PST-RPL-009).
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
	for _, row := range deleted {
		if row.AuditRows != int64(len(deleted)) {
			return 0, fmt.Errorf("incomplete pending reply audit")
		}
		// The command may have reached the post owner's tenant before its
		// operation expired. The removal clears any copy there; a receiver
		// that never registered the reply records nothing.
		if err := hubreplies.EnqueueRemoved(ctx, q, hubreplies.Removed{
			PostID: row.PostID, ReplyID: row.ReplyID,
			PostOwnerDID: row.PostOwnerHubUserDid,
			AuthorDID:    row.AuthorHubUserDid, Version: row.Version + 1,
		}); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(expired), nil
}
