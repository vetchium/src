package db

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/postid"
)

type quotesHarness struct {
	*postsHarness
}

func newQuotesHarness(t *testing.T) *quotesHarness {
	t.Helper()
	return &quotesHarness{newPostsHarness(t)}
}

func (h *quotesHarness) newID() string {
	h.t.Helper()
	id, err := postid.New()
	if err != nil {
		h.t.Fatal(err)
	}
	return id
}

func (h *quotesHarness) quote(author pgtype.UUID, targetID string) (string, sqlc.InsertHubQuotePostRow) {
	h.t.Helper()
	owner, err := dbvalue.NewUUID()
	if err != nil {
		h.t.Fatal(err)
	}
	id := h.newID()
	row, err := h.q.InsertHubQuotePost(h.ctx, sqlc.InsertHubQuotePostParams{
		PostID: id, Body: pgtype.Text{String: "my words", Valid: true},
		ReplyPolicy: sqlc.VetchiumHubPostPolicyEveryone,
		QuotePolicy: sqlc.VetchiumHubPostPolicyEveryone,
		QuoteTargetType: sqlc.NullVetchiumHubQuoteTargetType{
			VetchiumHubQuoteTargetType: sqlc.VetchiumHubQuoteTargetTypeTimelinePost, Valid: true,
		},
		QuoteOwnerPrincipalType: "hub_user", QuoteOwnerDid: owner,
		QuoteOwnerAddress: "owner", QuoteOwnerTenantID: "tenant-b",
		QuoteTargetID: targetID, AuthorHubUserDid: author, TenantID: "tenant-a",
	})
	if err != nil {
		h.t.Fatal(err)
	}
	return id, row
}

func (h *quotesHarness) record(target string, quoter pgtype.UUID, quoteID string, detached bool, at time.Time) int64 {
	h.t.Helper()
	n, err := h.q.InsertHubPostQuote(h.ctx, sqlc.InsertHubPostQuoteParams{
		TargetPostID: target, QuoterHubUserDid: quoter, QuoterHandle: "quoter",
		QuoterTenantID: "tenant-a", QuotePostID: quoteID, Detached: detached,
	})
	if err != nil {
		h.t.Fatal(err)
	}
	if n == 1 {
		if _, err := h.tx.Exec(h.ctx,
			`UPDATE vetchium.hub_post_quotes SET created_at = $3 WHERE target_post_id = $1 AND quote_post_id = $2`,
			target, quoteID, at); err != nil {
			h.t.Fatal(err)
		}
	}
	return n
}

func (h *quotesHarness) quoteCount(id string) int32 {
	h.t.Helper()
	var n int32
	if err := h.tx.QueryRow(h.ctx,
		`SELECT quote_count FROM vetchium.hub_posts WHERE post_id = $1`, id).Scan(&n); err != nil {
		h.t.Fatal(err)
	}
	return n
}

func TestHubQuotePostInsertAndKindCheck(t *testing.T) {
	h := newQuotesHarness(t)
	u := h.user("quoter")
	// Free tier quotes: the statement has no plan gate (PST-QTE-001).
	id, row := h.quote(u, h.newID())
	if row.InsertedRows != 1 || row.AuditRows != 1 {
		t.Fatalf("insert = %+v", row)
	}
	posts, err := h.q.GetHubPostsByIDs(h.ctx, sqlc.GetHubPostsByIDsParams{
		AuthorHubUserDid: u, PostIds: []string{id},
	})
	if err != nil || len(posts) != 1 {
		t.Fatalf("get = %v, %v", posts, err)
	}
	if posts[0].Kind != sqlc.VetchiumHubPostKindQuote || !posts[0].QuoteTargetType.Valid ||
		posts[0].QuoteOwnerAddress.String != "owner" || posts[0].QuoteTargetID.String == "" {
		t.Fatalf("quote columns = %+v", posts[0])
	}

	// A quote with a missing reference column breaks the CHECK.
	sp, err := h.tx.Begin(h.ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = sp.Exec(h.ctx, `INSERT INTO vetchium.hub_posts (post_id, author_hub_user_did, kind, body)
        VALUES ($1, $2, 'quote', 'x')`, h.newID(), u)
	if err == nil {
		t.Fatal("quote without target inserted")
	}
	_ = sp.Rollback(h.ctx)

	// A top-level post with a quote column breaks the CHECK.
	sp, err = h.tx.Begin(h.ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = sp.Exec(h.ctx, `INSERT INTO vetchium.hub_posts (post_id, author_hub_user_did, kind, body, quote_target_id)
        VALUES ($1, $2, 'post', 'x', 'abc')`, h.newID(), u)
	if err == nil {
		t.Fatal("post with quote target inserted")
	}
	_ = sp.Rollback(h.ctx)
}

func TestHubPostQuoteInsertAndRedelivery(t *testing.T) {
	h := newQuotesHarness(t)
	owner, quoter := h.user("owner"), h.user("quoter")
	h.setPlan(owner, "hub-silver-tier")
	target, _ := h.create(owner, "target")
	qid := h.newID()

	if n := h.record(target, quoter, qid, false, time.Now()); n != 1 {
		t.Fatalf("insert = %d, want 1", n)
	}
	if n, err := h.q.IncrementHubPostQuoteCount(h.ctx, target); err != nil || n != 1 {
		t.Fatalf("increment = %d, %v", n, err)
	}
	if n := h.record(target, quoter, qid, false, time.Now()); n != 0 {
		t.Fatalf("redelivery inserted %d rows, want 0", n)
	}
	if c := h.quoteCount(target); c != 1 {
		t.Fatalf("quote_count = %d, want 1", c)
	}
	got, err := h.q.GetHubPostQuote(h.ctx, sqlc.GetHubPostQuoteParams{TargetPostID: target, QuotePostID: qid})
	if err != nil || got.DetachedAt.Valid {
		t.Fatalf("get = %+v, %v", got, err)
	}
	state, err := h.q.GetHubPostForQuote(h.ctx, target)
	if err != nil || state.State != sqlc.VetchiumHubPostStateLive ||
		state.QuotePolicy != sqlc.VetchiumHubPostPolicyEveryone || state.AuthorHubUserDid != owner {
		t.Fatalf("for quote = %+v, %v", state, err)
	}
}

func TestHubPostQuoteDetachOnce(t *testing.T) {
	h := newQuotesHarness(t)
	owner, quoter := h.user("owner"), h.user("quoter")
	h.setPlan(owner, "hub-silver-tier")
	target, _ := h.create(owner, "target")
	qid := h.newID()
	h.record(target, quoter, qid, false, time.Now())
	if _, err := h.q.IncrementHubPostQuoteCount(h.ctx, target); err != nil {
		t.Fatal(err)
	}

	args := sqlc.DetachHubPostQuoteParams{TargetPostID: target, QuotePostID: qid}
	if n, err := h.q.DetachHubPostQuote(h.ctx, args); err != nil || n != 1 {
		t.Fatalf("detach = %d, %v", n, err)
	}
	if n, err := h.q.DetachHubPostQuote(h.ctx, args); err != nil || n != 0 {
		t.Fatalf("second detach = %d, %v", n, err)
	}
	if n, err := h.q.DecrementHubPostQuoteCount(h.ctx, target); err != nil || n != 1 {
		t.Fatalf("decrement = %d, %v", n, err)
	}
	if c := h.quoteCount(target); c != 0 {
		t.Fatalf("quote_count = %d, want 0", c)
	}
	// The count never goes below zero.
	if _, err := h.q.DecrementHubPostQuoteCount(h.ctx, target); err != nil {
		t.Fatal(err)
	}
	if c := h.quoteCount(target); c != 0 {
		t.Fatalf("quote_count = %d, want 0", c)
	}
}

func TestHubPostQuoteDeleteReturnsDetachedAt(t *testing.T) {
	h := newQuotesHarness(t)
	owner, quoter := h.user("owner"), h.user("quoter")
	h.setPlan(owner, "hub-silver-tier")
	target, _ := h.create(owner, "target")
	live, detached := h.newID(), h.newID()
	h.record(target, quoter, live, false, time.Now())
	h.record(target, quoter, detached, true, time.Now())

	at, err := h.q.DeleteHubPostQuote(h.ctx, sqlc.DeleteHubPostQuoteParams{TargetPostID: target, QuotePostID: live})
	if err != nil || at.Valid {
		t.Fatalf("delete live = %+v, %v", at, err)
	}
	at, err = h.q.DeleteHubPostQuote(h.ctx, sqlc.DeleteHubPostQuoteParams{TargetPostID: target, QuotePostID: detached})
	if err != nil || !at.Valid {
		t.Fatalf("delete detached = %+v, %v", at, err)
	}
	if _, err := h.q.DeleteHubPostQuote(h.ctx, sqlc.DeleteHubPostQuoteParams{TargetPostID: target, QuotePostID: live}); err == nil {
		t.Fatal("second delete found a row")
	}
}

func TestHubPostQuoteListKeyset(t *testing.T) {
	h := newQuotesHarness(t)
	owner, quoter := h.user("owner"), h.user("quoter")
	h.setPlan(owner, "hub-silver-tier")
	target, _ := h.create(owner, "target")
	base := time.Now().Add(-time.Hour)
	ids := make([]string, 4)
	for i := range ids {
		ids[i] = h.newID()
		h.record(target, quoter, ids[i], i == 2, base.Add(time.Duration(i)*time.Minute))
	}

	page, err := h.q.ListHubPostQuotes(h.ctx, sqlc.ListHubPostQuotesParams{TargetPostID: target, PageLimit: 3})
	if err != nil || len(page) != 3 {
		t.Fatalf("first page = %d, %v", len(page), err)
	}
	// Newest first; the detached third row is left out.
	if page[0].QuotePostID != ids[3] || page[1].QuotePostID != ids[1] || page[2].QuotePostID != ids[0] {
		t.Fatalf("order = %v", page)
	}
	next, err := h.q.ListHubPostQuotes(h.ctx, sqlc.ListHubPostQuotesParams{
		TargetPostID:      target,
		BeforeCreatedAt:   pgtype.Timestamptz{Time: page[0].CreatedAt.Time, Valid: true},
		BeforeQuotePostID: pgtype.Text{String: page[0].QuotePostID, Valid: true},
		PageLimit:         3,
	})
	if err != nil || len(next) != 2 || next[0].QuotePostID != ids[1] {
		t.Fatalf("next page = %v, %v", next, err)
	}
	// Cleanup deletes in bounded pages until a page is empty.
	for _, want := range []int64{3, 1, 0} {
		n, err := h.q.DeleteHubPostQuotesPage(h.ctx, sqlc.DeleteHubPostQuotesPageParams{
			TargetPostID: target, Batch: 3,
		})
		if err != nil || n != want {
			t.Fatalf("delete page = %d, %v, want %d", n, err, want)
		}
	}
}
