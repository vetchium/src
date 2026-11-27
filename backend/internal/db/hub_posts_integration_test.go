package db

import (
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/postid"
)

var silverPlans = []string{"hub-silver-tier", "hub-gold-tier"}

type postsHarness struct {
	*blocksHarness
}

func newPostsHarness(t *testing.T) *postsHarness {
	t.Helper()
	return &postsHarness{newBlocksHarness(t)}
}

func (h *postsHarness) setPlan(did pgtype.UUID, plan string) {
	h.t.Helper()
	query := `UPDATE vetchium.hub_users SET hub_plan_oid = $2,
        subscription_billing_interval = 'month', subscription_anchor_at = now(),
        subscription_period_start = now(),
        subscription_period_end = now() + interval '1 month'
        WHERE hub_user_did = $1`
	if plan == "hub-free-tier" {
		query = `UPDATE vetchium.hub_users SET hub_plan_oid = $2,
        subscription_billing_interval = NULL, subscription_anchor_at = NULL,
        subscription_period_start = NULL, subscription_period_end = NULL
        WHERE hub_user_did = $1`
	}
	if _, err := h.tx.Exec(h.ctx, query, did, plan); err != nil {
		h.t.Fatal(err)
	}
}

func (h *postsHarness) create(author pgtype.UUID, body string) (string, int64) {
	h.t.Helper()
	id, err := postid.New()
	if err != nil {
		h.t.Fatal(err)
	}
	row, err := h.q.InsertHubPost(h.ctx, sqlc.InsertHubPostParams{
		PostID: id, AuthorHubUserDid: author, Body: pgtype.Text{String: body, Valid: true},
		ReplyPolicy:      sqlc.VetchiumHubPostPolicyEveryone,
		QuotePolicy:      sqlc.VetchiumHubPostPolicyEveryone,
		EntitledPlanOids: silverPlans, TenantID: "tenant-a",
	})
	if err != nil {
		h.t.Fatal(err)
	}
	if row.InsertedRows != row.AuditRows {
		h.t.Fatalf("audit rows = %d, want %d", row.AuditRows, row.InsertedRows)
	}
	return id, row.InsertedRows
}

func (h *postsHarness) edit(author pgtype.UUID, id string, revision int32, body string) sqlc.EditHubPostRow {
	h.t.Helper()
	row, err := h.q.EditHubPost(h.ctx, sqlc.EditHubPostParams{
		PostID: id, AuthorHubUserDid: author, Revision: revision,
		EntitledPlanOids: silverPlans, Body: pgtype.Text{String: body, Valid: true},
		TenantID: "tenant-a",
	})
	if err != nil {
		h.t.Fatal(err)
	}
	return row
}

func (h *postsHarness) backdate(id string, age time.Duration) {
	h.t.Helper()
	if _, err := h.tx.Exec(h.ctx,
		`UPDATE vetchium.hub_posts SET created_at = now() - $2::interval WHERE post_id = $1`,
		id, age.String()); err != nil {
		h.t.Fatal(err)
	}
}

func (h *postsHarness) revisions(id string) int {
	h.t.Helper()
	var n int
	if err := h.tx.QueryRow(h.ctx,
		`SELECT count(*) FROM vetchium.hub_post_revisions WHERE post_id = $1`, id).Scan(&n); err != nil {
		h.t.Fatal(err)
	}
	return n
}

func TestHubPostPlanGate(t *testing.T) {
	h := newPostsHarness(t)
	u := h.user("post-gate")
	if _, n := h.create(u, "free tier"); n != 0 {
		t.Fatalf("free tier inserted %d rows, want 0", n)
	}
	h.setPlan(u, "hub-silver-tier")
	id, n := h.create(u, "silver tier")
	if n != 1 {
		t.Fatalf("silver inserted %d rows, want 1", n)
	}
	locked, err := h.q.LockHubUserForPosting(h.ctx, u)
	if err != nil || locked.HubPlanOid != "hub-silver-tier" {
		t.Fatalf("lock = %+v, %v", locked, err)
	}
	count, err := h.q.CountHubPostsSince(h.ctx, sqlc.CountHubPostsSinceParams{
		AuthorHubUserDid: u,
		Since:            pgtype.Timestamptz{Time: time.Now().Add(-24 * time.Hour), Valid: true},
	})
	if err != nil || count != 1 {
		t.Fatalf("count = %d, %v; post %s", count, err, id)
	}
}

func TestHubPostEdit(t *testing.T) {
	h := newPostsHarness(t)
	u := h.user("post-edit")
	h.setPlan(u, "hub-silver-tier")
	id, _ := h.create(u, "first")

	if row := h.edit(u, id, 1, "second"); row.UpdatedRows != 1 || row.KeptRows != 1 || row.AuditRows != 1 {
		t.Fatalf("edit = %+v", row)
	}
	if h.revisions(id) != 1 {
		t.Fatalf("revisions = %d, want 1", h.revisions(id))
	}
	var old string
	if err := h.tx.QueryRow(h.ctx,
		`SELECT body FROM vetchium.hub_post_revisions WHERE post_id = $1 AND revision = 1`, id).Scan(&old); err != nil || old != "first" {
		t.Fatalf("kept body = %q, %v", old, err)
	}
	var revision int32
	var version int64
	var editedSet bool
	if err := h.tx.QueryRow(h.ctx,
		`SELECT revision, version, edited_at IS NOT NULL FROM vetchium.hub_posts WHERE post_id = $1`, id).
		Scan(&revision, &version, &editedSet); err != nil || revision != 2 || version != 2 || !editedSet {
		t.Fatalf("post = %d %d %v, %v", revision, version, editedSet, err)
	}

	// A stale revision updates nothing.
	if row := h.edit(u, id, 1, "stale"); row.UpdatedRows != 0 {
		t.Fatalf("stale edit updated %d rows", row.UpdatedRows)
	}
	state, err := h.q.GetHubPostEditState(h.ctx, sqlc.GetHubPostEditStateParams{
		PostID: id, AuthorHubUserDid: u, EntitledPlanOids: silverPlans})
	if err != nil || state.Revision != 2 || !state.WindowOpen || !state.PlanEntitled {
		t.Fatalf("state = %+v, %v", state, err)
	}

	// A closed window updates nothing.
	h.backdate(id, 31*time.Minute)
	if row := h.edit(u, id, 2, "late"); row.UpdatedRows != 0 {
		t.Fatalf("late edit updated %d rows", row.UpdatedRows)
	}
	state, _ = h.q.GetHubPostEditState(h.ctx, sqlc.GetHubPostEditStateParams{
		PostID: id, AuthorHubUserDid: u, EntitledPlanOids: silverPlans})
	if state.WindowOpen {
		t.Fatal("window still open after 31 minutes")
	}

	// A lost plan updates nothing.
	id2, _ := h.create(u, "plan")
	h.setPlan(u, "hub-free-tier")
	if row := h.edit(u, id2, 1, "frozen"); row.UpdatedRows != 0 {
		t.Fatalf("frozen edit updated %d rows", row.UpdatedRows)
	}
	state, _ = h.q.GetHubPostEditState(h.ctx, sqlc.GetHubPostEditStateParams{
		PostID: id2, AuthorHubUserDid: u, EntitledPlanOids: silverPlans})
	if state.PlanEntitled {
		t.Fatal("free plan reported as entitled")
	}

	// A removed post updates nothing.
	h.setPlan(u, "hub-silver-tier")
	id3, _ := h.create(u, "gone")
	if _, err := h.q.RemoveHubPost(h.ctx, sqlc.RemoveHubPostParams{
		PostID: id3, AuthorHubUserDid: u, TenantID: "tenant-a"}); err != nil {
		t.Fatal(err)
	}
	if row := h.edit(u, id3, 1, "again"); row.UpdatedRows != 0 {
		t.Fatalf("removed edit updated %d rows", row.UpdatedRows)
	}
}

func TestHubPostRemoveClearsBodyAndRevisions(t *testing.T) {
	h := newPostsHarness(t)
	u := h.user("post-remove")
	h.setPlan(u, "hub-silver-tier")
	id, _ := h.create(u, "words")
	h.edit(u, id, 1, "more words")
	if h.revisions(id) != 1 {
		t.Fatal("setup: want one revision")
	}
	row, err := h.q.RemoveHubPost(h.ctx, sqlc.RemoveHubPostParams{
		PostID: id, AuthorHubUserDid: u, TenantID: "tenant-a"})
	if err != nil || row.RemovedRows != 1 || row.AuditRows != 1 {
		t.Fatalf("remove = %+v, %v", row, err)
	}
	if h.revisions(id) != 0 {
		t.Fatal("revisions kept after removal")
	}
	var body pgtype.Text
	var state string
	var removed bool
	var version int64
	if err := h.tx.QueryRow(h.ctx,
		`SELECT body, state::text, removed_at IS NOT NULL, version FROM vetchium.hub_posts WHERE post_id = $1`, id).
		Scan(&body, &state, &removed, &version); err != nil {
		t.Fatal(err)
	}
	if body.Valid || state != "removed" || !removed || version != 3 {
		t.Fatalf("post = %+v %s %v %d", body, state, removed, version)
	}
	again, err := h.q.RemoveHubPost(h.ctx, sqlc.RemoveHubPostParams{
		PostID: id, AuthorHubUserDid: u, TenantID: "tenant-a"})
	if err != nil || again.RemovedRows != 0 {
		t.Fatalf("second remove = %+v, %v", again, err)
	}
}

func TestHubPostPolicies(t *testing.T) {
	h := newPostsHarness(t)
	u := h.user("post-policy")
	h.setPlan(u, "hub-silver-tier")
	id, _ := h.create(u, "policy")
	set := func(reply sqlc.VetchiumHubPostPolicy, locked bool) sqlc.SetHubPostPoliciesRow {
		row, err := h.q.SetHubPostPolicies(h.ctx, sqlc.SetHubPostPoliciesParams{
			ReplyPolicy: reply, QuotePolicy: sqlc.VetchiumHubPostPolicyNobody,
			Locked: locked, PostID: id, AuthorHubUserDid: u, TenantID: "tenant-a"})
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	lockedAt := func() pgtype.Timestamptz {
		var ts pgtype.Timestamptz
		if err := h.tx.QueryRow(h.ctx,
			`SELECT locked_at FROM vetchium.hub_posts WHERE post_id = $1`, id).Scan(&ts); err != nil {
			t.Fatal(err)
		}
		return ts
	}
	if row := set(sqlc.VetchiumHubPostPolicyNobody, true); row.UpdatedRows != 1 || row.AuditRows != 1 {
		t.Fatalf("set = %+v", row)
	}
	first := lockedAt()
	if !first.Valid {
		t.Fatal("locked_at not set")
	}
	// The statement shares one transaction clock, so a changed lock time would
	// still compare equal; push the stored time back to prove it is kept.
	past := first.Time.Add(-time.Hour)
	if _, err := h.tx.Exec(h.ctx,
		`UPDATE vetchium.hub_posts SET locked_at = $2 WHERE post_id = $1`, id, past); err != nil {
		t.Fatal(err)
	}
	set(sqlc.VetchiumHubPostPolicyEveryone, true)
	if got := lockedAt(); !got.Time.Equal(past) {
		t.Fatalf("locked_at changed to %v, want %v", got.Time, past)
	}
	set(sqlc.VetchiumHubPostPolicyEveryone, false)
	if lockedAt().Valid {
		t.Fatal("locked_at kept after unlock")
	}
}

func TestHubPostListKeyset(t *testing.T) {
	h := newPostsHarness(t)
	u := h.user("post-list")
	h.setPlan(u, "hub-silver-tier")
	ids := make([]string, 3)
	for i := range ids {
		ids[i], _ = h.create(u, "post")
		h.backdate(ids[i], time.Duration(3-i)*time.Hour)
	}
	removed, _ := h.create(u, "removed")
	if _, err := h.q.RemoveHubPost(h.ctx, sqlc.RemoveHubPostParams{
		PostID: removed, AuthorHubUserDid: u, TenantID: "tenant-a"}); err != nil {
		t.Fatal(err)
	}

	page1, err := h.q.ListHubPostsByAuthor(h.ctx, sqlc.ListHubPostsByAuthorParams{
		AuthorHubUserDid: u, PageLimit: 3})
	if err != nil || len(page1) != 3 || page1[0].PostID != ids[2] || page1[1].PostID != ids[1] {
		t.Fatalf("page1 = %+v, %v", page1, err)
	}
	last := page1[1]
	page2, err := h.q.ListHubPostsByAuthor(h.ctx, sqlc.ListHubPostsByAuthorParams{
		AuthorHubUserDid: u, PageLimit: 3,
		BeforeCreatedAt: last.CreatedAt,
		BeforePostID:    pgtype.Text{String: last.PostID, Valid: true},
	})
	if err != nil || len(page2) != 1 || page2[0].PostID != ids[0] {
		t.Fatalf("page2 = %+v, %v", page2, err)
	}
	got, err := h.q.GetHubPostsByIDs(h.ctx, sqlc.GetHubPostsByIDsParams{
		AuthorHubUserDid: u, PostIds: []string{ids[0], removed}})
	if err != nil || len(got) != 1 || got[0].PostID != ids[0] {
		t.Fatalf("by ids = %+v, %v", got, err)
	}
}

// expectCheckViolation runs the insert in a savepoint so the harness
// transaction survives the refused row.
func (h *postsHarness) expectCheckViolation(name, id, body string) {
	h.t.Helper()
	u := h.user("post-check-" + name)
	sp, err := h.tx.Begin(h.ctx)
	if err != nil {
		h.t.Fatal(err)
	}
	_, err = sp.Exec(h.ctx, `INSERT INTO vetchium.hub_posts
        (post_id, author_hub_user_did, kind, body) VALUES ($1, $2, 'post', $3)`,
		id, u, body)
	_ = sp.Rollback(h.ctx)
	if err == nil || !strings.Contains(err.Error(), "check constraint") {
		h.t.Fatalf("%s: err = %v, want a check violation", name, err)
	}
}

func TestHubPostChecks(t *testing.T) {
	h := newPostsHarness(t)
	good, err := postid.New()
	if err != nil {
		t.Fatal(err)
	}
	h.expectCheckViolation("long", good, strings.Repeat("é", 513))
	h.expectCheckViolation("empty", good, "")
	h.expectCheckViolation("padded", good, " padded")
	h.expectCheckViolation("badid", strings.ToUpper(good), "body")

	// 512 multi-byte code points pass.
	u := h.user("post-check-ok")
	if _, err := h.tx.Exec(h.ctx, `INSERT INTO vetchium.hub_posts
        (post_id, author_hub_user_did, kind, body) VALUES ($1, $2, 'post', $3)`,
		good, u, strings.Repeat("é", 512)); err != nil {
		t.Fatalf("512 code points refused: %v", err)
	}
}
