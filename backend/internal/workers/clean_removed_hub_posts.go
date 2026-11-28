package workers

import (
	"context"
	"encoding/json"
	"fmt"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	hubposts "github.com/vetchium/src/typespec/hub/posts"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/events"
)

const (
	// hubPostCleanupAuthorsPerCommit bounds the events one commit enqueues
	// (PST-RPL-013).
	hubPostCleanupAuthorsPerCommit = 100
	// hubPostCleanupRowsPerCommit bounds the structure or quote rows one
	// commit deletes.
	hubPostCleanupRowsPerCommit  = 1000
	hubPostCleanupPostsPerRun    = 20
	hubPostCleanupCommitsPerPost = 50
)

// cleanRemovedHubPosts finishes the removal of each removed post that has no
// `cleanup_done_at` (PST-RPL-013). Each commit does one bounded step: it
// enqueues hub-post-removed to at most 100 reply authors and records the last
// one, or deletes at most 1,000 structure rows, or at most 1,000 quote rows.
// A crash resumes at the next step. The commit that finds nothing left marks
// the post done.
func (w *Worker) cleanRemovedHubPosts(ctx context.Context) error {
	posts, err := w.queries.ListRemovedHubPostsForCleanup(ctx, hubPostCleanupPostsPerRun)
	if err != nil {
		return fmt.Errorf("list removed Hub posts: %w", err)
	}
	for _, post := range posts {
		for range hubPostCleanupCommitsPerPost {
			done, err := w.cleanHubPostPage(ctx, post.PostID)
			if err != nil {
				return fmt.Errorf("clean removed Hub post: %w", err)
			}
			if done {
				break
			}
		}
	}
	return nil
}

// cleanHubPostPage runs one commit of a post's cleanup and reports whether
// that commit finished it. The post is read again under the commit, so two
// workers never enqueue the same page.
func (w *Worker) cleanHubPostPage(ctx context.Context, postID string) (bool, error) {
	tx, err := w.hubPostDB.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	post, err := q.GetHubPostForCleanup(ctx, postID)
	if err != nil {
		return false, err
	}
	if post.State == sqlc.VetchiumHubPostStateLive || post.CleanupDoneAt.Valid {
		return true, nil
	}
	step, count, err := w.cleanHubPostStep(ctx, q, post)
	if err != nil {
		return false, err
	}
	done := step == "done"
	payload, err := json.Marshal(map[string]any{
		"schema_version": 1, "step": step, "count": count, "done": done,
	})
	if err != nil {
		return false, err
	}
	if err := q.InsertHubPostAuditEvent(ctx, sqlc.InsertHubPostAuditEventParams{
		TenantID: w.tenantID, Action: "hub.post.cleanup-committed",
		EntityType: "hub_post", EntityID: postID, ActorType: "worker",
		ActorID: "workers", SubjectHubUserDid: post.AuthorHubUserDid,
		Source: "workers", Payload: payload,
	}); err != nil {
		return false, err
	}
	return done, tx.Commit(ctx)
}

// cleanHubPostStep runs the next step of one post's cleanup in q and names
// it: "authors", "replies", "quotes", or "done".
func (w *Worker) cleanHubPostStep(
	ctx context.Context, q *sqlc.Queries, post sqlc.GetHubPostForCleanupRow,
) (string, int64, error) {
	authors, err := q.ListHubPostReplyAuthors(ctx, sqlc.ListHubPostReplyAuthorsParams{
		PostID: post.PostID, AfterAuthorHubUserDid: post.CleanupAuthorCursor,
		PageLimit: hubPostCleanupAuthorsPerCommit,
	})
	if err != nil {
		return "", 0, err
	}
	if len(authors) > 0 {
		outgoing := make([]events.Outgoing, len(authors))
		for index, author := range authors {
			outgoing[index] = events.Outgoing{
				Kind: federationspec.HubPostRemovedKind,
				Destination: events.Principal{
					Type: directoryspec.PrincipalHubUser,
					DID:  author.AuthorHubUserDid,
				},
				AggregateType:    federationspec.AggregateHubPost,
				AggregateID:      post.PostID,
				AggregateVersion: post.Version,
				Payload: federationspec.HubPostRemovedPayload{
					PostID: hubposts.PostID(post.PostID),
					OwnerHubUserDID: hub.HubUserDID(
						dbvalue.FormatUUID(post.AuthorHubUserDid)),
				},
			}
		}
		if err := events.EnqueueAll(ctx, q, outgoing); err != nil {
			return "", 0, err
		}
		rows, err := q.SetHubPostCleanupCursor(ctx,
			sqlc.SetHubPostCleanupCursorParams{
				CleanupAuthorCursor: authors[len(authors)-1].AuthorHubUserDid,
				PostID:              post.PostID,
			})
		if err != nil {
			return "", 0, err
		}
		if rows != 1 {
			return "", 0, fmt.Errorf("record post cleanup cursor: %d rows", rows)
		}
		return "authors", int64(len(authors)), nil
	}
	replies, err := q.DeleteHubPostReplyLeaves(ctx, sqlc.DeleteHubPostReplyLeavesParams{
		PostID: post.PostID, Batch: hubPostCleanupRowsPerCommit,
	})
	if err != nil {
		return "", 0, err
	}
	if replies > 0 {
		return "replies", replies, nil
	}
	// A removed target shows no quotes, so its index rows go too.
	quotes, err := q.DeleteHubPostQuotesPage(ctx, sqlc.DeleteHubPostQuotesPageParams{
		TargetPostID: post.PostID, Batch: hubPostCleanupRowsPerCommit,
	})
	if err != nil {
		return "", 0, err
	}
	if quotes > 0 {
		return "quotes", quotes, nil
	}
	rows, err := q.MarkHubPostCleanupDone(ctx, post.PostID)
	if err != nil {
		return "", 0, err
	}
	if rows != 1 {
		return "", 0, fmt.Errorf("mark post cleanup done: %d rows", rows)
	}
	return "done", 0, nil
}
