package db

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/postid"
)

type repliesHarness struct {
	*postsHarness
}

func newRepliesHarness(t *testing.T) *repliesHarness {
	t.Helper()
	return &repliesHarness{newPostsHarness(t)}
}

func (h *repliesHarness) newID() string {
	h.t.Helper()
	id, err := postid.New()
	if err != nil {
		h.t.Fatal(err)
	}
	return id
}

func (h *repliesHarness) pending(author, owner pgtype.UUID, postID, parent string) (string, pgtype.UUID) {
	h.t.Helper()
	op, err := dbvalue.NewUUID()
	if err != nil {
		h.t.Fatal(err)
	}
	id := h.newID()
	p := pgtype.Text{}
	if parent != "" {
		p = pgtype.Text{String: parent, Valid: true}
	}
	if err := h.q.InsertPendingHubReplyText(h.ctx, sqlc.InsertPendingHubReplyTextParams{
		ReplyID: id, AuthorHubUserDid: author, PostOwnerHubUserDid: owner,
		PostOwnerHandle: "owner", PostOwnerTenantID: "tenant-a", PostID: postID,
		ParentReplyID: p, OperationID: op, Body: pgtype.Text{String: "hello", Valid: true},
	}); err != nil {
		h.t.Fatal(err)
	}
	return id, op
}

func (h *repliesHarness) copyRow(postID, replyID, parent string, author pgtype.UUID, at time.Time) {
	h.t.Helper()
	p := pgtype.Text{}
	if parent != "" {
		p = pgtype.Text{String: parent, Valid: true}
	}
	n, err := h.q.InsertHubPostReply(h.ctx, sqlc.InsertHubPostReplyParams{
		PostID: postID, ReplyID: replyID, ParentReplyID: p,
		AuthorHubUserDid: author, AuthorHandle: "replier", AuthorTenantID: "tenant-a",
		Body: pgtype.Text{String: "copy", Valid: true},
	})
	if err != nil || n != 1 {
		h.t.Fatalf("insert copy = %d, %v", n, err)
	}
	if _, err := h.tx.Exec(h.ctx,
		`UPDATE vetchium.hub_post_replies SET created_at = $3 WHERE post_id = $1 AND reply_id = $2`,
		postID, replyID, at); err != nil {
		h.t.Fatal(err)
	}
}

func (h *repliesHarness) textState(id string) string {
	h.t.Helper()
	var s string
	if err := h.tx.QueryRow(h.ctx,
		`SELECT state::text FROM vetchium.hub_reply_texts WHERE reply_id = $1`, id).Scan(&s); err != nil {
		h.t.Fatal(err)
	}
	return s
}

func TestHubReplyTextSettleAndDelete(t *testing.T) {
	h := newRepliesHarness(t)
	author, owner := h.user("replier"), h.user("owner")
	h.setPlan(owner, "hub-silver-tier")
	postID, _ := h.create(owner, "post")

	id, op := h.pending(author, owner, postID, "")
	n, err := h.q.SettleHubReplyTextLive(h.ctx, op)
	if err != nil || n != 1 || h.textState(id) != "live" {
		t.Fatalf("settle = %d, %v, state %s", n, err, h.textState(id))
	}
	var hasOp bool
	if err := h.tx.QueryRow(h.ctx,
		`SELECT operation_id IS NOT NULL FROM vetchium.hub_reply_texts WHERE reply_id = $1`, id).Scan(&hasOp); err != nil || hasOp {
		t.Fatalf("operation id kept: %v, %v", hasOp, err)
	}
	if n, _ := h.q.SettleHubReplyTextLive(h.ctx, op); n != 0 {
		t.Fatalf("second settle changed %d rows", n)
	}

	id2, op2 := h.pending(author, owner, postID, "")
	if n, err := h.q.DeletePendingHubReplyText(h.ctx, op2); err != nil || n != 1 {
		t.Fatalf("delete pending = %d, %v", n, err)
	}
	if n, _ := h.q.DeletePendingHubReplyText(h.ctx, op); n != 0 {
		t.Fatalf("delete of a settled reply changed %d rows", n)
	}
	if h.textState(id) != "live" {
		t.Fatal("live reply was deleted")
	}
	_ = id2
}

func TestHubReplyTextEditRemoveAndCap(t *testing.T) {
	h := newRepliesHarness(t)
	author, owner := h.user("replier"), h.user("owner")
	h.setPlan(owner, "hub-silver-tier")
	postID, _ := h.create(owner, "post")
	id, op := h.pending(author, owner, postID, "")
	if _, err := h.q.SettleHubReplyTextLive(h.ctx, op); err != nil {
		t.Fatal(err)
	}

	count, err := h.q.CountHubRepliesSince(h.ctx, sqlc.CountHubRepliesSinceParams{
		AuthorHubUserDid: author,
		Since:            pgtype.Timestamptz{Time: time.Now().Add(-24 * time.Hour), Valid: true},
	})
	if err != nil || count != 1 {
		t.Fatalf("count = %d, %v", count, err)
	}

	edit := func(revision int32) sqlc.EditHubReplyTextRow {
		row, err := h.q.EditHubReplyText(h.ctx, sqlc.EditHubReplyTextParams{
			ReplyID: id, AuthorHubUserDid: author, Revision: revision,
			Body: pgtype.Text{String: "edited", Valid: true}, TenantID: "tenant-a",
		})
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	if row := edit(2); row.UpdatedRows != 0 {
		t.Fatalf("stale revision updated %d rows", row.UpdatedRows)
	}
	row := edit(1)
	if row.UpdatedRows != 1 || row.KeptRows != 1 || row.AuditRows != 1 || row.NewRevision != 2 || row.NewVersion != 2 {
		t.Fatalf("edit = %+v", row)
	}

	rm, err := h.q.RemoveHubReplyText(h.ctx, sqlc.RemoveHubReplyTextParams{
		ReplyID: id, AuthorHubUserDid: author, TenantID: "tenant-a",
	})
	if err != nil || rm.RemovedRows != 1 || rm.AuditRows != 1 || rm.NewVersion != 3 {
		t.Fatalf("remove = %+v, %v", rm, err)
	}
	var revisions int
	var bodyNull bool
	if err := h.tx.QueryRow(h.ctx,
		`SELECT (SELECT count(*) FROM vetchium.hub_reply_revisions WHERE reply_id = $1),
                (SELECT body IS NULL FROM vetchium.hub_reply_texts WHERE reply_id = $1)`, id).Scan(&revisions, &bodyNull); err != nil || revisions != 0 || !bodyNull {
		t.Fatalf("after remove: revisions %d, body null %v, %v", revisions, bodyNull, err)
	}
	if row := edit(2); row.UpdatedRows != 0 {
		t.Fatalf("edit of a removed reply updated %d rows", row.UpdatedRows)
	}
}

func TestHubRepliesParentMustShareThePost(t *testing.T) {
	h := newRepliesHarness(t)
	owner, replier := h.user("owner"), h.user("replier")
	h.setPlan(owner, "hub-silver-tier")
	postA, _ := h.create(owner, "a")
	postB, _ := h.create(owner, "b")
	parent := h.newID()
	h.copyRow(postA, parent, "", replier, time.Now())

	_, err := h.q.InsertHubPostReply(h.ctx, sqlc.InsertHubPostReplyParams{
		PostID: postB, ReplyID: h.newID(), ParentReplyID: pgtype.Text{String: parent, Valid: true},
		AuthorHubUserDid: replier, AuthorHandle: "replier", AuthorTenantID: "tenant-a",
		Body: pgtype.Text{String: "x", Valid: true},
	})
	if err == nil {
		t.Fatal("a parent in another post was accepted")
	}
}

func TestHubPostReplyThreadOrderAndKeyset(t *testing.T) {
	h := newRepliesHarness(t)
	owner, replier := h.user("owner"), h.user("replier")
	h.setPlan(owner, "hub-silver-tier")
	postID, _ := h.create(owner, "post")
	base := time.Now().Add(-time.Hour)

	var tops []string
	for i := 0; i < 3; i++ {
		id := h.newID()
		tops = append(tops, id)
		h.copyRow(postID, id, "", replier, base.Add(time.Duration(i)*time.Minute))
	}
	var kids []string
	for i := 0; i < 3; i++ {
		id := h.newID()
		kids = append(kids, id)
		h.copyRow(postID, id, tops[0], replier, base.Add(time.Duration(10+i)*time.Minute))
	}

	page := func(parent string, after pgtype.Timestamptz, afterID string, limit int32) []sqlc.ListHubPostRepliesRow {
		p := pgtype.Text{}
		if parent != "" {
			p = pgtype.Text{String: parent, Valid: true}
		}
		a := pgtype.Text{}
		if afterID != "" {
			a = pgtype.Text{String: afterID, Valid: true}
		}
		rows, err := h.q.ListHubPostReplies(h.ctx, sqlc.ListHubPostRepliesParams{
			PostID: postID, ParentReplyID: p, AfterCreatedAt: after, AfterReplyID: a, PageLimit: limit,
		})
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}

	first := page("", pgtype.Timestamptz{}, "", 2)
	if len(first) != 2 || first[0].ReplyID != tops[0] || first[1].ReplyID != tops[1] {
		t.Fatalf("first top page = %+v", first)
	}
	second := page("", first[1].CreatedAt, first[1].ReplyID, 2)
	if len(second) != 1 || second[0].ReplyID != tops[2] {
		t.Fatalf("second top page = %+v", second)
	}
	sub := page(tops[0], pgtype.Timestamptz{}, "", 10)
	if len(sub) != 3 || sub[0].ReplyID != kids[0] || sub[2].ReplyID != kids[2] {
		t.Fatalf("children = %+v", sub)
	}
	subNext := page(tops[0], sub[0].CreatedAt, sub[0].ReplyID, 10)
	if len(subNext) != 2 || subNext[0].ReplyID != kids[1] {
		t.Fatalf("children after first = %+v", subNext)
	}
}

func TestHubPostReplyCountRuleAndCopy(t *testing.T) {
	h := newRepliesHarness(t)
	owner, replier := h.user("owner"), h.user("replier")
	h.setPlan(owner, "hub-silver-tier")
	postID, _ := h.create(owner, "post")
	top, kid := h.newID(), h.newID()
	h.copyRow(postID, top, "", replier, time.Now())
	h.copyRow(postID, kid, top, replier, time.Now())

	adjust := func(reply, child, rows int32) {
		t.Helper()
		if _, err := h.q.AdjustHubPostReplyCounts(h.ctx, sqlc.AdjustHubPostReplyCountsParams{
			PostID: postID, ParentReplyID: pgtype.Text{String: top, Valid: true},
			ReplyDelta: reply, ChildDelta: child, ChildRowDelta: rows,
		}); err != nil {
			t.Fatal(err)
		}
	}
	adjust(1, 1, 1)
	hid, err := h.q.SetHubPostReplyState(h.ctx, sqlc.SetHubPostReplyStateParams{
		PostID: postID, ReplyID: kid, NewState: sqlc.VetchiumHubPostReplyStateHiddenByOwner,
	})
	if err != nil || hid.OldState != sqlc.VetchiumHubPostReplyStateLive {
		t.Fatalf("hide = %+v, %v", hid, err)
	}
	// A repeat reports no change, so the handler writes no audit event.
	again, err := h.q.SetHubPostReplyState(h.ctx, sqlc.SetHubPostReplyStateParams{
		PostID: postID, ReplyID: kid, NewState: sqlc.VetchiumHubPostReplyStateHiddenByOwner,
	})
	if err != nil || again.OldState != sqlc.VetchiumHubPostReplyStateHiddenByOwner ||
		again.NewState != sqlc.VetchiumHubPostReplyStateHiddenByOwner {
		t.Fatalf("repeat hide = %+v, %v", again, err)
	}
	adjust(-1, -1, -1)
	var postCount, child, rows int32
	if err := h.tx.QueryRow(h.ctx, `SELECT
        (SELECT reply_count FROM vetchium.hub_posts WHERE post_id = $1),
        (SELECT child_count FROM vetchium.hub_post_replies WHERE post_id = $1 AND reply_id = $2),
        (SELECT child_row_count FROM vetchium.hub_post_replies WHERE post_id = $1 AND reply_id = $2)`,
		postID, top).Scan(&postCount, &child, &rows); err != nil {
		t.Fatal(err)
	}
	if postCount != 0 || child != 0 || rows != 1 {
		t.Fatalf("counts = %d, %d, %d; the child row count must stay 1", postCount, child, rows)
	}

	if n, err := h.q.UpdateHubPostReplyCopy(h.ctx, sqlc.UpdateHubPostReplyCopyParams{
		PostID: postID, ReplyID: kid, Body: pgtype.Text{String: "edited", Valid: true}, Revision: 2,
	}); err != nil || n != 1 {
		t.Fatalf("update copy = %d, %v", n, err)
	}
	cleared, err := h.q.ClearHubPostReplyCopy(h.ctx, sqlc.ClearHubPostReplyCopyParams{PostID: postID, ReplyID: kid})
	if err != nil || cleared.OldState != sqlc.VetchiumHubPostReplyStateHiddenByOwner {
		t.Fatalf("clear = %+v, %v", cleared, err)
	}
	if n, err := h.q.UpdateHubPostReplyCopy(h.ctx, sqlc.UpdateHubPostReplyCopyParams{
		PostID: postID, ReplyID: kid, Body: pgtype.Text{String: "late", Valid: true}, Revision: 3,
	}); err != nil || n != 0 {
		t.Fatalf("copy update of an author_removed row = %d, %v", n, err)
	}
	if _, err := h.q.SetHubPostReplyState(h.ctx, sqlc.SetHubPostReplyStateParams{
		PostID: postID, ReplyID: kid, NewState: sqlc.VetchiumHubPostReplyStateLive,
	}); err == nil {
		t.Fatal("unhide of an author_removed row changed it")
	}
	if _, err := h.q.ClearHubPostReplyCopy(h.ctx, sqlc.ClearHubPostReplyCopyParams{PostID: postID, ReplyID: kid}); err == nil {
		t.Fatal("second clear changed a row")
	}
}

func TestHubRepliesPostRemovedMarksOnlyPendingAndLive(t *testing.T) {
	h := newRepliesHarness(t)
	author, owner := h.user("replier"), h.user("owner")
	h.setPlan(owner, "hub-silver-tier")
	postID, _ := h.create(owner, "post")

	pend, _ := h.pending(author, owner, postID, "")
	live, op := h.pending(author, owner, postID, "")
	if _, err := h.q.SettleHubReplyTextLive(h.ctx, op); err != nil {
		t.Fatal(err)
	}
	gone, op3 := h.pending(author, owner, postID, "")
	if _, err := h.q.SettleHubReplyTextLive(h.ctx, op3); err != nil {
		t.Fatal(err)
	}
	if _, err := h.q.RemoveHubReplyText(h.ctx, sqlc.RemoveHubReplyTextParams{
		ReplyID: gone, AuthorHubUserDid: author, TenantID: "tenant-a",
	}); err != nil {
		t.Fatal(err)
	}

	n, err := h.q.MarkHubRepliesPostRemoved(h.ctx, sqlc.MarkHubRepliesPostRemovedParams{
		AuthorHubUserDid: author, PostOwnerHubUserDid: owner, PostID: postID,
	})
	if err != nil || n != 2 {
		t.Fatalf("marked = %d, %v", n, err)
	}
	if h.textState(pend) != "post_removed" || h.textState(live) != "post_removed" || h.textState(gone) != "removed" {
		t.Fatalf("states = %s, %s, %s", h.textState(pend), h.textState(live), h.textState(gone))
	}
	tab, err := h.q.ListHubReplyTextsByAuthor(h.ctx, sqlc.ListHubReplyTextsByAuthorParams{
		AuthorHubUserDid: author, PageLimit: 10,
	})
	if err != nil || len(tab) != 2 {
		t.Fatalf("tab = %d rows, %v", len(tab), err)
	}
	for _, r := range tab {
		if r.Body.Valid {
			t.Fatalf("post_removed row %s returned words", r.ReplyID)
		}
	}
	if n, err := h.q.DeleteHubReplyTextsByIDs(h.ctx, sqlc.DeleteHubReplyTextsByIDsParams{
		ReplyIds: []string{pend, live}, TenantID: "tenant-a",
	}); err != nil || len(n) != 0 {
		t.Fatalf("reaper deleted %d non-pending rows, %v", len(n), err)
	}
}

func TestHubReplyReaperDeletesExpiredPending(t *testing.T) {
	h := newRepliesHarness(t)
	author, owner := h.user("replier"), h.user("owner")
	h.setPlan(owner, "hub-silver-tier")
	postID, _ := h.create(owner, "post")
	id, op := h.pending(author, owner, postID, "")
	other, _ := h.pending(author, owner, postID, "")

	cmd, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.tx.Exec(h.ctx, `INSERT INTO vetchium.federation_operations
        (operation_id, command_id, kind, target_authority, aggregate_id,
         owner_principal_type, owner_principal_id, idempotency_key,
         request_digest, payload_bytes, created_at, updated_at, expires_at,
         authority_principal_type, authority_principal_did)
        VALUES ($1, $2, 'hub-post-reply-register', 'tenant', $3, 'hub_user', $4,
                'k', sha256('x'), '\x7b7d', now() - interval '2 hours',
                now() - interval '2 hours', now() - interval '1 hour',
                'hub_user', $5)`, op, cmd, id, dbvalue.FormatUUID(author), owner); err != nil {
		t.Fatal(err)
	}
	expired, err := h.q.ListExpiredPendingHubReplyTexts(h.ctx, 10)
	if err != nil || len(expired) != 1 || expired[0].ReplyID != id {
		t.Fatalf("expired = %+v, %v", expired, err)
	}
	del, err := h.q.DeleteHubReplyTextsByIDs(h.ctx, sqlc.DeleteHubReplyTextsByIDsParams{
		ReplyIds: []string{id}, TenantID: "tenant-a",
	})
	// The reaper tells the owner's tenant with these fields (PST-RPL-009).
	if err != nil || len(del) != 1 || del[0].AuditRows != 1 ||
		del[0].ReplyID != id || del[0].PostID != postID ||
		del[0].AuthorHubUserDid != author || del[0].PostOwnerHubUserDid != owner {
		t.Fatalf("reap = %+v, %v", del, err)
	}
	if h.textState(other) != "pending" {
		t.Fatal("an unexpired pending reply changed")
	}
}

func TestHubPostCleanupAuthorKeyset(t *testing.T) {
	h := newRepliesHarness(t)
	owner := h.user("owner")
	h.setPlan(owner, "hub-silver-tier")
	postID, _ := h.create(owner, "post")
	live, _ := h.create(owner, "kept")

	const authors = 205
	for i := 0; i < authors; i++ {
		a := h.user("a")
		// Two replies by each author give one distinct row for each.
		h.copyRow(postID, h.newID(), "", a, time.Now())
		h.copyRow(postID, h.newID(), "", a, time.Now())
	}
	h.copyRow(live, h.newID(), "", h.user("b"), time.Now())
	// A chain three deep: cleanup must delete a child before its parent.
	chainAuthor := h.user("chain")
	top, mid := h.newID(), h.newID()
	h.copyRow(postID, top, "", chainAuthor, time.Now())
	h.copyRow(postID, mid, top, chainAuthor, time.Now())
	h.copyRow(postID, h.newID(), mid, chainAuthor, time.Now())

	if got, err := h.q.ListRemovedHubPostsForCleanup(h.ctx, 10); err != nil || len(got) != 0 {
		t.Fatalf("cleanup list before removal = %d, %v", len(got), err)
	}
	if _, err := h.tx.Exec(h.ctx,
		`UPDATE vetchium.hub_posts SET state = 'removed', body = NULL, removed_at = now() WHERE post_id = $1`,
		postID); err != nil {
		t.Fatal(err)
	}
	got, err := h.q.ListRemovedHubPostsForCleanup(h.ctx, 10)
	if err != nil || len(got) != 1 || got[0].PostID != postID {
		t.Fatalf("cleanup list = %+v, %v", got, err)
	}

	seen := map[string]bool{}
	var after pgtype.UUID
	pages := 0
	for {
		page, err := h.q.ListHubPostReplyAuthors(h.ctx, sqlc.ListHubPostReplyAuthorsParams{
			PostID: postID, AfterAuthorHubUserDid: after, PageLimit: 100,
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(page) == 0 {
			break
		}
		pages++
		for _, a := range page {
			key := dbvalue.FormatUUID(a.AuthorHubUserDid)
			if seen[key] {
				t.Fatalf("author %s listed twice", key)
			}
			seen[key] = true
		}
		after = page[len(page)-1].AuthorHubUserDid
	}
	if len(seen) != authors+1 || pages != 3 {
		t.Fatalf("authors = %d in %d pages, want %d in 3", len(seen), pages, authors+1)
	}

	var deleted int64
	for steps := 0; ; steps++ {
		if steps > 20 {
			t.Fatal("leaf deletion did not end")
		}
		n, err := h.q.DeleteHubPostReplyLeaves(h.ctx, sqlc.DeleteHubPostReplyLeavesParams{
			PostID: postID, Batch: 100,
		})
		if err != nil {
			t.Fatal(err)
		}
		if n > 100 {
			t.Fatalf("one batch deleted %d rows", n)
		}
		if n == 0 {
			break
		}
		deleted += n
	}
	if deleted != 2*authors+3 {
		t.Fatalf("deleted = %d, want %d", deleted, 2*authors+3)
	}
	if n, err := h.q.MarkHubPostCleanupDone(h.ctx, postID); err != nil || n != 1 {
		t.Fatalf("mark done = %d, %v", n, err)
	}
	if got, _ := h.q.ListRemovedHubPostsForCleanup(h.ctx, 10); len(got) != 0 {
		t.Fatalf("cleanup list after done = %d", len(got))
	}
}
