package workers

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/hubquotes"
)

// hubPostPurgeBatch bounds the rows one commit changes (PST-RET-001).
const hubPostPurgeBatch = 1000

// purgeStep changes one batch of one table and returns how many rows it
// changed.
type purgeStep struct {
	table  string
	action string
	run    func(context.Context, *sqlc.Queries, pgtype.Timestamptz) (int64, error)
}

// purgeHubPosts removes posts, revisions, and reply texts older than five
// years (PST-RET-001). It retires a live post as a removal does, so post
// cleanup tells its reply authors and deletes its structure and quote rows in
// bounded commits. A later run deletes the cleaned post. Each commit changes
// at most 1,000 rows of one table and writes one audit event.
func (w *Worker) purgeHubPosts(ctx context.Context) error {
	cutoff, err := w.queries.GetHubPostRetentionCutoff(ctx)
	if err != nil {
		return fmt.Errorf("read the post cutoff: %w", err)
	}
	steps := []purgeStep{
		{table: "hub_post_revisions", action: "hub.posts.purged",
			run: func(ctx context.Context, q *sqlc.Queries, c pgtype.Timestamptz) (int64, error) {
				return q.PurgeHubPostRevisions(ctx, sqlc.PurgeHubPostRevisionsParams{
					Cutoff: c, Batch: hubPostPurgeBatch,
				})
			}},
		{table: "hub_posts", action: "hub.posts.retired", run: retireHubPosts},
		{table: "hub_posts", action: "hub.posts.purged",
			run: func(ctx context.Context, q *sqlc.Queries, c pgtype.Timestamptz) (int64, error) {
				return q.PurgeHubPosts(ctx, sqlc.PurgeHubPostsParams{
					Cutoff: c, Batch: hubPostPurgeBatch,
				})
			}},
		{table: "hub_reply_revisions", action: "hub.posts.purged",
			run: func(ctx context.Context, q *sqlc.Queries, c pgtype.Timestamptz) (int64, error) {
				return q.PurgeHubReplyRevisions(ctx, sqlc.PurgeHubReplyRevisionsParams{
					Cutoff: c, Batch: hubPostPurgeBatch,
				})
			}},
		{table: "hub_reply_texts", action: "hub.posts.purged",
			run: func(ctx context.Context, q *sqlc.Queries, c pgtype.Timestamptz) (int64, error) {
				return q.PurgeHubReplyTexts(ctx, sqlc.PurgeHubReplyTextsParams{
					Cutoff: c, Batch: hubPostPurgeBatch,
				})
			}},
	}
	for _, step := range steps {
		for {
			count, err := w.purgeHubPostBatch(ctx, step, cutoff)
			if err != nil {
				return fmt.Errorf("purge %s: %w", step.table, err)
			}
			if count < hubPostPurgeBatch {
				break
			}
		}
	}
	return nil
}

// retireHubPosts removes one batch of old live posts and enqueues
// hub-post-unquoted for each quote of a timeline post (PST-QTE-006).
func retireHubPosts(
	ctx context.Context, q *sqlc.Queries, cutoff pgtype.Timestamptz,
) (int64, error) {
	retired, err := q.RetireHubPosts(ctx, sqlc.RetireHubPostsParams{
		Cutoff: cutoff, Batch: hubPostPurgeBatch,
	})
	if err != nil {
		return 0, err
	}
	for _, post := range retired {
		if !post.QuoteTargetType.Valid || post.QuoteTargetType.VetchiumHubQuoteTargetType !=
			sqlc.VetchiumHubQuoteTargetTypeTimelinePost {
			continue
		}
		if err := hubquotes.EnqueueUnquoted(ctx, q, hubquotes.Unquoted{
			TargetOwnerDID: post.QuoteOwnerDid,
			TargetPostID:   post.QuoteTargetID.String,
			QuotePostID:    post.PostID,
			QuoterDID:      post.AuthorHubUserDid, Version: post.Version,
		}); err != nil {
			return 0, err
		}
	}
	return int64(len(retired)), nil
}

// purgeHubPostBatch runs one batch of step and its audit event in one
// transaction. A batch that changes nothing commits nothing.
func (w *Worker) purgeHubPostBatch(
	ctx context.Context, step purgeStep, cutoff pgtype.Timestamptz,
) (int64, error) {
	tx, err := w.hubPostDB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	count, err := step.run(ctx, q, cutoff)
	if err != nil {
		return 0, err
	}
	if count == 0 {
		return 0, nil
	}
	payload, err := json.Marshal(map[string]any{
		"schema_version": 1, "table": step.table, "count": count,
	})
	if err != nil {
		return 0, err
	}
	if err := q.InsertHubPostAuditEvent(ctx, sqlc.InsertHubPostAuditEventParams{
		TenantID: w.tenantID, Action: step.action,
		EntityType: "hub_post_table", EntityID: step.table, ActorType: "worker",
		ActorID: "workers", Source: "workers", Payload: payload,
	}); err != nil {
		return 0, err
	}
	return count, tx.Commit(ctx)
}
