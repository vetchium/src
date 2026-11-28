package workers

import (
	"fmt"
	"testing"

	"backend/internal/postid"
)

const oldAge = "6 years"

func (f *postsFixture) count(sql string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.owner.QueryRow(f.ctx, sql, args...).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

func (f *postsFixture) clearPurgeAudit() {
	f.exec(`DELETE FROM vetchium.audit_events
        WHERE action IN ('hub.posts.purged', 'hub.posts.retired')`)
}

func (f *postsFixture) newID() string {
	f.t.Helper()
	id, err := postid.New()
	if err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *postsFixture) age(table, key, id, age string) {
	f.t.Helper()
	f.exec(fmt.Sprintf(
		`UPDATE vetchium.%s SET created_at = now() - interval '%s' WHERE %s = $1`,
		table, age, key), id)
}

func (f *postsFixture) newReplyRow(
	post, parent string, author [16]byte, ageText string,
) string {
	f.t.Helper()
	id := f.newID()
	var parentArg any
	if parent != "" {
		parentArg = parent
	}
	f.exec(fmt.Sprintf(`INSERT INTO vetchium.hub_post_replies
        (post_id, reply_id, parent_reply_id, author_hub_user_did, author_handle,
         author_tenant_id, body, created_at)
        VALUES ($1, $2, $3, $4, 'someone', 'sgp', 'words',
                now() - interval '%s')`, ageText), post, id, parentArg, author)
	return id
}

func (f *postsFixture) auditCounts(action, table string) string {
	f.t.Helper()
	rows, err := f.owner.Query(f.ctx, `SELECT (payload ->> 'count')::int
        FROM vetchium.audit_events
        WHERE action = $1 AND entity_id = $2
        ORDER BY created_at, audit_event_id`, action, table)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	var counts []int
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			f.t.Fatal(err)
		}
		counts = append(counts, n)
	}
	if err := rows.Err(); err != nil {
		f.t.Fatal(err)
	}
	return fmt.Sprint(counts)
}

// An old post leaves in three runs: the purge retires it, post cleanup tells
// its reply authors and deletes its rows, and the next purge deletes it.
func TestPurgeHubPostsRetiresThenDeletesIntegration(t *testing.T) {
	f := newPostsFixture(t)
	f.clearPurgeAudit()
	t.Cleanup(f.clearPurgeAudit)
	owner := f.newUser()
	other := f.newUser()

	oldPost := f.newPost(owner, false)
	f.age("hub_posts", "post_id", oldPost, oldAge)
	f.exec(`INSERT INTO vetchium.hub_post_revisions (post_id, revision, body)
        VALUES ($1, 2, 'earlier')`, oldPost)
	oldPostReply := f.newReplyRow(oldPost, "", other.Bytes, oldAge)
	oldPostQuote := f.newID()
	f.exec(`INSERT INTO vetchium.hub_post_quotes (target_post_id,
        quoter_hub_user_did, quoter_handle, quoter_tenant_id, quote_post_id)
        VALUES ($1, $2, 'quoter', 'sgp', $3)`, oldPost, other, oldPostQuote)

	// An old quote of another user's post: its retirement tells that user.
	oldQuote := f.newID()
	quotedPost := f.newID()
	f.exec(`INSERT INTO vetchium.hub_posts (post_id, author_hub_user_did, kind,
            body, quote_target_type, quote_owner_principal_type, quote_owner_did,
            quote_owner_address, quote_owner_tenant_id, quote_target_id,
            created_at)
        VALUES ($1, $2, 'quote', 'a quote', 'timeline_post', 'hub_user', $3,
            'other', 'sgp', $4, now() - interval '`+oldAge+`')`,
		oldQuote, owner, other, quotedPost)
	t.Cleanup(func() {
		f.exec(`DELETE FROM vetchium.federation_outbox
            WHERE aggregate_id IN ($1, $2)`, oldPost, oldQuote)
	})

	youngPost := f.newPost(owner, false)
	youngReply := f.newReplyRow(youngPost, "", other.Bytes, "1 day")
	oldText := f.newReplyText(other, owner, youngPost, false, "")
	f.age("hub_reply_texts", "reply_id", oldText, oldAge)
	f.exec(`INSERT INTO vetchium.hub_reply_revisions (reply_id, revision, body)
        VALUES ($1, 2, 'earlier')`, oldText)
	youngText := f.newReplyText(other, owner, youngPost, false, "")

	rows := func(sql, arg string) int {
		return f.count(sql, arg)
	}
	const (
		postRows     = `SELECT count(*) FROM vetchium.hub_posts WHERE post_id = $1`
		replyRows    = `SELECT count(*) FROM vetchium.hub_post_replies WHERE reply_id = $1`
		quoteRows    = `SELECT count(*) FROM vetchium.hub_post_quotes WHERE quote_post_id = $1`
		textRows     = `SELECT count(*) FROM vetchium.hub_reply_texts WHERE reply_id = $1`
		postRevision = `SELECT count(*) FROM vetchium.hub_post_revisions WHERE post_id = $1`
		textRevision = `SELECT count(*) FROM vetchium.hub_reply_revisions WHERE reply_id = $1`
	)

	worker := f.worker()
	if err := worker.purgeHubPosts(f.ctx); err != nil {
		t.Fatal(err)
	}
	if got := f.scalar(`SELECT state::text || ' ' || (body IS NULL)::text ||
            ' ' || version::text FROM vetchium.hub_posts WHERE post_id = $1`,
		oldPost); got != "removed true 2" {
		t.Fatalf("old post after retirement = %s", got)
	}
	if got := f.scalar(`SELECT state::text FROM vetchium.hub_posts
        WHERE post_id = $1`, youngPost); got != "live" {
		t.Fatalf("young post = %s", got)
	}
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE aggregate_id = $1 AND kind = 'hub-post-unquoted'
          AND destination_principal_did = $2`, oldQuote, other); got != "1" {
		t.Fatalf("unquoted events = %s", got)
	}
	for name, check := range map[string]struct {
		sql, arg string
		want     int
	}{
		"old post revision":  {postRevision, oldPost, 0},
		"old post reply row": {replyRows, oldPostReply, 1},
		"old post quote row": {quoteRows, oldPostQuote, 1},
		"young reply row":    {replyRows, youngReply, 1},
		"old reply text":     {textRows, oldText, 0},
		"old reply revision": {textRevision, oldText, 0},
		"young reply text":   {textRows, youngText, 1},
	} {
		if got := rows(check.sql, check.arg); got != check.want {
			t.Errorf("%s: %d rows, want %d", name, got, check.want)
		}
	}
	if got := f.auditCounts("hub.posts.retired", "hub_posts"); got != "[2]" {
		t.Errorf("retired audit counts = %s, want [2]", got)
	}

	if err := worker.cleanRemovedHubPosts(f.ctx); err != nil {
		t.Fatal(err)
	}
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE aggregate_id = $1 AND kind = 'hub-post-removed'
          AND destination_principal_did = $2`, oldPost, other); got != "1" {
		t.Fatalf("removed events = %s", got)
	}
	if err := worker.purgeHubPosts(f.ctx); err != nil {
		t.Fatal(err)
	}
	for name, check := range map[string]struct {
		sql, arg string
		want     int
	}{
		"old post":           {postRows, oldPost, 0},
		"old quote":          {postRows, oldQuote, 0},
		"old post reply row": {replyRows, oldPostReply, 0},
		"old post quote row": {quoteRows, oldPostQuote, 0},
		"young post":         {postRows, youngPost, 1},
		"young reply row":    {replyRows, youngReply, 1},
	} {
		if got := rows(check.sql, check.arg); got != check.want {
			t.Errorf("%s: %d rows, want %d", name, got, check.want)
		}
	}
	if got := f.auditCounts("hub.posts.purged", "hub_posts"); got != "[2]" {
		t.Errorf("purged audit counts = %s, want [2]", got)
	}
	if got := f.count(`SELECT count(*) FROM vetchium.audit_events
        WHERE action IN ('hub.posts.purged', 'hub.posts.retired')
          AND payload::text LIKE '%a post%'`); got != 0 {
		t.Errorf("audit events with words = %d", got)
	}
}

func TestPurgeHubPostsCommitsInBatchesIntegration(t *testing.T) {
	f := newPostsFixture(t)
	f.clearPurgeAudit()
	t.Cleanup(f.clearPurgeAudit)
	owner := f.newUser()
	prefix := f.newID()[:8]
	f.exec(`INSERT INTO vetchium.hub_posts
            (post_id, author_hub_user_did, kind, body, created_at)
        SELECT substr(md5($2 || i::text), 1, 20) || substr(md5(i::text || $2), 1, 20),
               $1, 'post', 'a post', now() - interval '`+oldAge+`'
        FROM generate_series(1, 2500) AS i`, owner, prefix)

	worker := f.worker()
	if err := worker.purgeHubPosts(f.ctx); err != nil {
		t.Fatal(err)
	}
	if got := f.count(`SELECT count(*) FROM vetchium.hub_posts
        WHERE author_hub_user_did = $1 AND state = 'removed'`, owner); got != 2500 {
		t.Fatalf("retired posts = %d, want 2500", got)
	}
	if got := f.auditCounts("hub.posts.retired", "hub_posts"); got != "[1000 1000 500]" {
		t.Fatalf("retired audit counts = %s, want [1000 1000 500]", got)
	}
	// These posts have no replies or quotes; stand in for their cleanup.
	f.exec(`UPDATE vetchium.hub_posts SET cleanup_done_at = now()
        WHERE author_hub_user_did = $1`, owner)
	if err := worker.purgeHubPosts(f.ctx); err != nil {
		t.Fatal(err)
	}
	if got := f.count(`SELECT count(*) FROM vetchium.hub_posts
        WHERE author_hub_user_did = $1`, owner); got != 0 {
		t.Fatalf("posts left = %d, want 0", got)
	}
	if got := f.auditCounts("hub.posts.purged", "hub_posts"); got != "[1000 1000 500]" {
		t.Fatalf("purged audit counts = %s, want [1000 1000 500]", got)
	}
}
