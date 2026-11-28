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
	hubPostCleanupPostsPerRun      = 20
	hubPostCleanupCommitsPerPost   = 50
)

// cleanRemovedHubPosts finishes the removal of each removed post that has no
// `cleanup_done_at` (PST-RPL-013). Each commit enqueues hub-post-removed to at
// most 100 reply authors and records its last author, so a crash resumes
// after that author. The last commit deletes the post's structure and quote
// rows.
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
	authors, err := q.ListHubPostReplyAuthors(ctx, sqlc.ListHubPostReplyAuthorsParams{
		PostID: postID, AfterAuthorHubUserDid: post.CleanupAuthorCursor,
		PageLimit: hubPostCleanupAuthorsPerCommit,
	})
	if err != nil {
		return false, err
	}
	outgoing := make([]events.Outgoing, len(authors))
	for index, author := range authors {
		outgoing[index] = events.Outgoing{
			Kind: federationspec.HubPostRemovedKind,
			Destination: events.Principal{
				Type: directoryspec.PrincipalHubUser, DID: author.AuthorHubUserDid,
			},
			AggregateType:    federationspec.AggregateHubPost,
			AggregateID:      postID,
			AggregateVersion: post.Version,
			Payload: federationspec.HubPostRemovedPayload{
				PostID: hubposts.PostID(postID),
				OwnerHubUserDID: hub.HubUserDID(
					dbvalue.FormatUUID(post.AuthorHubUserDid)),
			},
		}
	}
	if err := events.EnqueueAll(ctx, q, outgoing); err != nil {
		return false, err
	}
	done := len(authors) < hubPostCleanupAuthorsPerCommit
	if done {
		if _, err := q.DeleteHubPostRepliesByPost(ctx, postID); err != nil {
			return false, err
		}
		// A removed target shows no quotes, so its index rows go too.
		if _, err := q.DeleteHubPostQuotesByPost(ctx, postID); err != nil {
			return false, err
		}
		if rows, err := q.MarkHubPostCleanupDone(ctx, postID); err != nil {
			return false, err
		} else if rows != 1 {
			return false, fmt.Errorf("mark post cleanup done: %d rows", rows)
		}
	} else if rows, err := q.SetHubPostCleanupCursor(ctx,
		sqlc.SetHubPostCleanupCursorParams{
			CleanupAuthorCursor: authors[len(authors)-1].AuthorHubUserDid,
			PostID:              postID,
		}); err != nil {
		return false, err
	} else if rows != 1 {
		return false, fmt.Errorf("record post cleanup cursor: %d rows", rows)
	}
	payload, err := json.Marshal(map[string]any{
		"schema_version": 1, "authors": len(authors), "done": done,
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
