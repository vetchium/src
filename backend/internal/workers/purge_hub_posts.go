package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
)

const (
	// hubPostPurgeBatch bounds the rows one commit deletes (PST-RET-001).
	hubPostPurgeBatch = 1000
	// hubPostRetention is the age after which a post goes in any state.
	hubPostRetention = "5 years"
)

// purgeHubPosts hard-deletes posts, reply texts, reply structure rows, and
// quote rows older than five years (PST-RET-001). Each commit deletes at most
// 1,000 rows of one table and writes one audit event (PST-GEN-004).
func (w *Worker) purgeHubPosts(ctx context.Context) error {
	cutoff, err := w.hubPostCutoff(ctx)
	if err != nil {
		return err
	}
	type step struct {
		table string
		purge func(context.Context, sqlc.Querier, sqlc.PurgeHubPostsParams) (int64, error)
		// untilEmpty repeats the step until a pass deletes no row, because a
		// pass leaves each parent that had a child row in the same pass.
		untilEmpty bool
	}
	steps := []step{
		{table: "hub_posts", purge: func(
			ctx context.Context, q sqlc.Querier, p sqlc.PurgeHubPostsParams,
		) (int64, error) {
			return q.PurgeHubPosts(ctx, p)
		}},
		{table: "hub_reply_texts", purge: func(
			ctx context.Context, q sqlc.Querier, p sqlc.PurgeHubPostsParams,
		) (int64, error) {
			return q.PurgeHubReplyTexts(ctx, sqlc.PurgeHubReplyTextsParams(p))
		}},
		{table: "hub_post_replies", untilEmpty: true, purge: func(
			ctx context.Context, q sqlc.Querier, p sqlc.PurgeHubPostsParams,
		) (int64, error) {
			return q.PurgeHubPostReplies(ctx, sqlc.PurgeHubPostRepliesParams(p))
		}},
		{table: "hub_post_quotes", purge: func(
			ctx context.Context, q sqlc.Querier, p sqlc.PurgeHubPostsParams,
		) (int64, error) {
			return q.PurgeHubPostQuotes(ctx, sqlc.PurgeHubPostQuotesParams(p))
		}},
	}
	params := sqlc.PurgeHubPostsParams{Cutoff: cutoff, Batch: hubPostPurgeBatch}
	for _, s := range steps {
		for {
			count, err := w.purgeHubPostBatch(ctx, s.table, params, s.purge)
			if err != nil {
				return fmt.Errorf("purge %s: %w", s.table, err)
			}
			if count == 0 || (count < hubPostPurgeBatch && !s.untilEmpty) {
				break
			}
		}
	}
	return nil
}

// hubPostCutoff reads the cutoff from the database clock, so the job and the
// stored timestamps use one clock.
func (w *Worker) hubPostCutoff(ctx context.Context) (pgtype.Timestamptz, error) {
	var cutoff time.Time
	err := w.hubPostDB.QueryRow(ctx,
		"SELECT now() - interval '"+hubPostRetention+"'").Scan(&cutoff)
	if err != nil {
		return pgtype.Timestamptz{}, fmt.Errorf("read the post cutoff: %w", err)
	}
	return pgtype.Timestamptz{Time: cutoff, Valid: true}, nil
}

// purgeHubPostBatch deletes one batch and its audit event in one transaction.
// A batch that deletes nothing commits nothing.
func (w *Worker) purgeHubPostBatch(
	ctx context.Context, table string, params sqlc.PurgeHubPostsParams,
	purge func(context.Context, sqlc.Querier, sqlc.PurgeHubPostsParams) (int64, error),
) (int64, error) {
	tx, err := w.hubPostDB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	count, err := purge(ctx, q, params)
	if err != nil {
		return 0, err
	}
	if count == 0 {
		return 0, nil
	}
	payload, err := json.Marshal(map[string]any{
		"schema_version": 1, "table": table, "count": count,
	})
	if err != nil {
		return 0, err
	}
	if err := q.InsertHubPostAuditEvent(ctx, sqlc.InsertHubPostAuditEventParams{
		TenantID: w.tenantID, Action: "hub.posts.purged",
		EntityType: "hub_post_table", EntityID: table, ActorType: "worker",
		ActorID: "workers", Source: "workers", Payload: payload,
	}); err != nil {
		return 0, err
	}
	return count, tx.Commit(ctx)
}
