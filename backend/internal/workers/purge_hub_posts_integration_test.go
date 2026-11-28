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
	f.exec(`DELETE FROM vetchium.audit_events WHERE action = 'hub.posts.purged'`)
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

func TestPurgeHubPostsRemovesOnlyOldRowsIntegration(t *testing.T) {
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

	youngPost := f.newPost(owner, false)
	youngQuote := f.newID()
	f.exec(`INSERT INTO vetchium.hub_post_quotes (target_post_id,
        quoter_hub_user_did, quoter_handle, quoter_tenant_id, quote_post_id,
        created_at)
        VALUES ($1, $2, 'quoter', 'sgp', $3, now() - interval '`+oldAge+`')`,
		youngPost, other, youngQuote)
	youngPostOldReply := f.newReplyRow(youngPost, "", other.Bytes, oldAge)
	youngPostYoungReply := f.newReplyRow(youngPost, "", other.Bytes, "1 day")
	f.exec(`INSERT INTO vetchium.hub_post_quotes (target_post_id,
        quoter_hub_user_did, quoter_handle, quoter_tenant_id, quote_post_id)
        VALUES ($1, $2, 'quoter', 'sgp', $3)`, youngPost, other, f.newID())

	oldText := f.newReplyText(other, owner, youngPost, false, "")
	f.age("hub_reply_texts", "reply_id", oldText, oldAge)
	f.exec(`INSERT INTO vetchium.hub_reply_revisions (reply_id, revision, body)
        VALUES ($1, 2, 'earlier')`, oldText)
	youngText := f.newReplyText(other, owner, youngPost, false, "")

	if err := f.worker().purgeHubPosts(f.ctx); err != nil {
		t.Fatal(err)
	}

	for name, want := range map[string]struct {
		sql  string
		arg  string
		want int
	}{
		"old post": {`SELECT count(*) FROM vetchium.hub_posts WHERE post_id = $1`, oldPost, 0},
		"old post revision": {`SELECT count(*) FROM vetchium.hub_post_revisions
            WHERE post_id = $1`, oldPost, 0},
		"old post reply row": {`SELECT count(*) FROM vetchium.hub_post_replies
            WHERE reply_id = $1`, oldPostReply, 0},
		"old post quote row": {`SELECT count(*) FROM vetchium.hub_post_quotes
            WHERE quote_post_id = $1`, oldPostQuote, 0},
		"young post":      {`SELECT count(*) FROM vetchium.hub_posts WHERE post_id = $1`, youngPost, 1},
		"old quote row":   {`SELECT count(*) FROM vetchium.hub_post_quotes WHERE quote_post_id = $1`, youngQuote, 0},
		"old reply row":   {`SELECT count(*) FROM vetchium.hub_post_replies WHERE reply_id = $1`, youngPostOldReply, 0},
		"young reply row": {`SELECT count(*) FROM vetchium.hub_post_replies WHERE reply_id = $1`, youngPostYoungReply, 1},
		"old reply text":  {`SELECT count(*) FROM vetchium.hub_reply_texts WHERE reply_id = $1`, oldText, 0},
		"old reply revision": {`SELECT count(*) FROM vetchium.hub_reply_revisions
            WHERE reply_id = $1`, oldText, 0},
		"young reply text": {`SELECT count(*) FROM vetchium.hub_reply_texts WHERE reply_id = $1`, youngText, 1},
	} {
		if got := f.count(want.sql, want.arg); got != want.want {
			t.Errorf("%s: %d rows, want %d", name, got, want.want)
		}
	}
	if got := f.count(`SELECT count(*) FROM vetchium.hub_post_quotes
        WHERE target_post_id = $1`, youngPost); got != 1 {
		t.Errorf("young quote rows = %d, want 1", got)
	}

	// One audit event for each table that lost rows; none holds words.
	for table, want := range map[string]int{
		"hub_posts": 1, "hub_post_replies": 1, "hub_post_quotes": 1,
		"hub_reply_texts": 1,
	} {
		got := f.count(`SELECT count(*) FROM vetchium.audit_events
            WHERE action = 'hub.posts.purged' AND entity_id = $1`, table)
		if got != want {
			t.Errorf("%s audit events = %d, want %d", table, got, want)
		}
	}
}

func TestPurgeHubPostsKeepsAParentWithAYoungerChildIntegration(t *testing.T) {
	f := newPostsFixture(t)
	f.clearPurgeAudit()
	t.Cleanup(f.clearPurgeAudit)
	owner := f.newUser()
	other := f.newUser()
	post := f.newPost(owner, false)
	parent := f.newReplyRow(post, "", other.Bytes, oldAge)
	child := f.newReplyRow(post, parent, other.Bytes, "1 day")

	if err := f.worker().purgeHubPosts(f.ctx); err != nil {
		t.Fatal(err)
	}
	if got := f.count(`SELECT count(*) FROM vetchium.hub_post_replies
        WHERE post_id = $1`, post); got != 2 {
		t.Fatalf("rows with a younger child = %d, want 2", got)
	}

	// Once the child is old, one run removes the child and then the parent.
	f.age("hub_post_replies", "reply_id", child, oldAge)
	if err := f.worker().purgeHubPosts(f.ctx); err != nil {
		t.Fatal(err)
	}
	if got := f.count(`SELECT count(*) FROM vetchium.hub_post_replies
        WHERE post_id = $1`, post); got != 0 {
		t.Fatalf("rows after the child aged = %d, want 0", got)
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

	if err := f.worker().purgeHubPosts(f.ctx); err != nil {
		t.Fatal(err)
	}
	if got := f.count(`SELECT count(*) FROM vetchium.hub_posts
        WHERE author_hub_user_did = $1`, owner); got != 0 {
		t.Fatalf("posts left = %d, want 0", got)
	}
	rows, err := f.owner.Query(f.ctx, `SELECT (payload ->> 'count')::int
        FROM vetchium.audit_events
        WHERE action = 'hub.posts.purged' AND entity_id = 'hub_posts'
        ORDER BY created_at, audit_event_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var counts []int
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		counts = append(counts, n)
	}
	if fmt.Sprint(counts) != "[1000 1000 500]" {
		t.Fatalf("audit counts = %v, want [1000 1000 500]", counts)
	}
}
