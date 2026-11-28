package workers

import (
	"context"
	"encoding/hex"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/postid"
)

// postsFixture holds the pools and the rows one test seeds; its cleanup
// removes them, since the stack's own workers share the database.
type postsFixture struct {
	t     *testing.T
	ctx   context.Context
	owner *pgxpool.Pool
	app   *pgxpool.Pool
	users []pgtype.UUID
}

func newPostsFixture(t *testing.T) *postsFixture {
	t.Helper()
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SET ROLE vetchium_app")
		return err
	}
	app, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	f := &postsFixture{t: t, ctx: ctx, owner: owner, app: app}
	t.Cleanup(func() {
		for _, did := range f.users {
			for _, sql := range []string{
				`DELETE FROM vetchium.audit_events WHERE subject_hub_user_did = $1`,
				`DELETE FROM vetchium.federation_outbox
                 WHERE destination_principal_did = $1
                    OR convert_from(payload_bytes, 'UTF8')::jsonb
                        ->> 'owner_hub_user_did' = $1::text`,
				`DELETE FROM vetchium.hub_users WHERE hub_user_did = $1`,
			} {
				_, _ = owner.Exec(ctx, sql, did)
			}
		}
	})
	return f
}

func (f *postsFixture) worker() *Worker {
	return &Worker{
		queries: sqlc.New(f.app), hubPostDB: f.app, tenantID: "sgp",
		log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func (f *postsFixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.owner.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatal(err)
	}
}

func (f *postsFixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var value string
	if err := f.owner.QueryRow(f.ctx, sql, args...).Scan(&value); err != nil {
		f.t.Fatal(err)
	}
	return value
}

func (f *postsFixture) newUser() pgtype.UUID {
	f.t.Helper()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		f.t.Fatal(err)
	}
	raw := hex.EncodeToString(did.Bytes[10:])
	f.exec(`INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')), 'Poster',
                'test-hash', 'SG', 'hub-free-tier')`,
		did, raw[:8]+"-"+raw[:11], "posts-"+dbvalue.FormatUUID(did)+"@example.com")
	f.users = append(f.users, did)
	return did
}

func (f *postsFixture) newPost(owner pgtype.UUID, removed bool) string {
	f.t.Helper()
	id, err := postid.New()
	if err != nil {
		f.t.Fatal(err)
	}
	if removed {
		f.exec(`INSERT INTO vetchium.hub_posts (post_id, author_hub_user_did, kind,
                body, state, removed_at, version)
            VALUES ($1, $2, 'post', NULL, 'removed', now(), 2)`, id, owner)
	} else {
		f.exec(`INSERT INTO vetchium.hub_posts (post_id, author_hub_user_did, kind, body)
            VALUES ($1, $2, 'post', 'a post')`, id, owner)
	}
	return id
}

func (f *postsFixture) newReplyText(
	author, owner pgtype.UUID, post string, pending bool, expiry string,
) string {
	f.t.Helper()
	id, err := postid.New()
	if err != nil {
		f.t.Fatal(err)
	}
	if !pending {
		f.exec(`INSERT INTO vetchium.hub_reply_texts (reply_id, author_hub_user_did,
                post_owner_hub_user_did, post_owner_handle, post_owner_tenant_id,
                post_id, body, state)
            VALUES ($1, $2, $3, 'owner', 'sgp', $4, 'words', 'live')`,
			id, author, owner, post)
		return id
	}
	operation, err := dbvalue.NewUUID()
	if err != nil {
		f.t.Fatal(err)
	}
	commandID, _ := dbvalue.NewUUID()
	f.exec(`INSERT INTO vetchium.federation_operations (operation_id, command_id,
            kind, target_authority, aggregate_id, owner_principal_type,
            owner_principal_id, idempotency_key, request_digest, payload_bytes,
            created_at, updated_at, expires_at, authority_principal_type,
            authority_principal_did)
        VALUES ($1, $2, 'hub-post-reply-register', 'tenant', $3, 'hub_user', $4,
            $5, sha256('x'), '{}', now() - interval '2 days',
            now() - interval '2 days', now() + $6::interval, 'hub_user', $7)`,
		operation, commandID, post, dbvalue.FormatUUID(author),
		"reaper-"+dbvalue.FormatUUID(operation), expiry, owner)
	f.exec(`INSERT INTO vetchium.hub_reply_texts (reply_id, author_hub_user_did,
            post_owner_hub_user_did, post_owner_handle, post_owner_tenant_id,
            post_id, operation_id, body, state)
        VALUES ($1, $2, $3, 'owner', 'sgp', $4, $5, 'words', 'pending')`,
		id, author, owner, post, operation)
	t := f.t
	t.Cleanup(func() {
		_, _ = f.owner.Exec(f.ctx, `DELETE FROM vetchium.federation_operations
            WHERE operation_id = $1`, operation)
	})
	return id
}

func TestReapHubPendingRepliesIntegration(t *testing.T) {
	f := newPostsFixture(t)
	owner, author := f.newUser(), f.newUser()
	post := f.newPost(owner, false)
	expired := f.newReplyText(author, owner, post, true, "-1 hour")
	waiting := f.newReplyText(author, owner, post, true, "1 hour")
	live := f.newReplyText(author, owner, post, false, "")

	if err := f.worker().reapHubPendingReplies(f.ctx); err != nil {
		t.Fatal(err)
	}
	exists := func(id string) string {
		return f.scalar(`SELECT count(*)::text FROM vetchium.hub_reply_texts
            WHERE reply_id = $1`, id)
	}
	if exists(expired) != "0" || exists(waiting) != "1" || exists(live) != "1" {
		t.Fatalf("rows after the reaper: expired %s, waiting %s, live %s",
			exists(expired), exists(waiting), exists(live))
	}
	if got := f.scalar(`SELECT count(*)::text || ' ' || bool_and(payload::text NOT LIKE '%words%')::text
        FROM vetchium.audit_events
        WHERE action = 'hub.reply.pending-reaped' AND entity_id = $1`, expired); got != "1 true" {
		t.Fatalf("audit events = %s", got)
	}
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.audit_events
        WHERE action = 'hub.reply.pending-reaped' AND entity_id = ANY($1)`,
		[]string{waiting, live}); got != "0" {
		t.Fatalf("audit events for kept rows = %s", got)
	}
	// The owner's tenant may hold a copy, so the reaper tells it once.
	t.Cleanup(func() {
		f.exec(`DELETE FROM vetchium.federation_outbox WHERE aggregate_id = $1`, expired)
	})
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE aggregate_id = $1 AND kind = 'hub-reply-removed'
          AND destination_principal_did = $2`, expired, owner); got != "1" {
		t.Fatalf("removed events = %s", got)
	}
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE aggregate_id = ANY($1)`, []string{waiting, live}); got != "0" {
		t.Fatalf("events for kept rows = %s", got)
	}
}

func TestCleanRemovedHubPostsPagesAuthorsIntegration(t *testing.T) {
	f := newPostsFixture(t)
	owner := f.newUser()
	live := f.newPost(owner, false)
	post := f.newPost(owner, true)
	const authors = 250
	f.exec(`INSERT INTO vetchium.hub_post_replies (post_id, reply_id, author_hub_user_did,
            author_handle, author_tenant_id, body)
        SELECT $1, md5(i::text || $1) || substr(md5($1 || i::text), 1, 8),
            ('01987aef-1234-7abc-8abc-' || lpad(i::text, 12, '0'))::uuid,
            'replier', 'sgp', 'copy'
        FROM generate_series(1, $2::int) AS i`, post, authors)
	// A second reply by the first author, and an author who removed their
	// reply: only the first author is enqueued, once.
	f.exec(`INSERT INTO vetchium.hub_post_replies (post_id, reply_id, author_hub_user_did,
            author_handle, author_tenant_id, body)
        VALUES ($1, 'aaaaaaaaaaaaaaaaaaaazzzzzzzzzzzzzzzzzzzz',
            '01987aef-1234-7abc-8abc-000000000001', 'replier', 'sgp', 'copy')`, post)
	f.exec(`INSERT INTO vetchium.hub_post_replies (post_id, reply_id, author_hub_user_did,
            author_handle, author_tenant_id, state)
        VALUES ($1, 'bbbbbbbbbbbbbbbbbbbbyyyyyyyyyyyyyyyyyyyy',
            '01987aef-1234-7abc-8abc-0000000009ff', 'replier', 'sgp',
            'author_removed')`, post)
	f.exec(`INSERT INTO vetchium.hub_post_replies (post_id, reply_id, author_hub_user_did,
            author_handle, author_tenant_id, body)
        VALUES ($1, 'cccccccccccccccccccckkkkkkkkkkkkkkkkkkkk',
            '01987aef-1234-7abc-8abc-000000000fff', 'replier', 'sgp', 'copy')`, live)
	t.Cleanup(func() {
		f.exec(`DELETE FROM vetchium.federation_outbox
            WHERE aggregate_id IN ($1, $2)`, post, live)
	})

	worker := f.worker()
	// One run finishes the post: author commits of 100, 100, and 50, then one
	// structure commit, then the commit that marks it done.
	if err := worker.cleanRemovedHubPosts(f.ctx); err != nil {
		t.Fatal(err)
	}
	if got := f.scalar(`SELECT count(*)::text || ' ' || count(DISTINCT xmin::text)::text
        FROM vetchium.federation_outbox WHERE aggregate_id = $1`, post); got != "250 3" {
		t.Fatalf("events and commits = %s", got)
	}
	if got := f.scalar(`SELECT count(DISTINCT destination_principal_did)::text
        FROM vetchium.federation_outbox WHERE aggregate_id = $1`, post); got != "250" {
		t.Fatalf("distinct authors = %s", got)
	}
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE aggregate_id = $1 AND kind = 'hub-post-removed'
          AND aggregate_version = 2
          AND convert_from(payload_bytes, 'UTF8')::jsonb ->> 'owner_hub_user_did' = $2`,
		post, dbvalue.FormatUUID(owner)); got != "250" {
		t.Fatalf("events with the owner and version = %s", got)
	}
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.hub_post_replies
        WHERE post_id = $1`, post); got != "0" {
		t.Fatalf("structure rows left = %s", got)
	}
	if got := f.scalar(`SELECT (cleanup_done_at IS NOT NULL)::text FROM vetchium.hub_posts
        WHERE post_id = $1`, post); got != "true" {
		t.Fatalf("cleanup_done_at set = %s", got)
	}
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.audit_events
        WHERE action = 'hub.post.cleanup-committed' AND entity_id = $1`, post); got != "5" {
		t.Fatalf("cleanup audit events = %s", got)
	}
	// Three author pages, one structure page, and the commit that ends it.
	if got := f.scalar(`SELECT string_agg(payload ->> 'step', ' '
            ORDER BY created_at, audit_event_id)
        FROM vetchium.audit_events
        WHERE action = 'hub.post.cleanup-committed' AND entity_id = $1`,
		post); got != "authors authors authors replies done" {
		t.Fatalf("cleanup steps = %s", got)
	}
	// A live post is left alone, and a finished post is not cleaned again.
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.hub_post_replies
        WHERE post_id = $1`, live); got != "1" {
		t.Fatalf("live post rows = %s", got)
	}
	if err := worker.cleanRemovedHubPosts(f.ctx); err != nil {
		t.Fatal(err)
	}
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE aggregate_id = $1`, post); got != "250" {
		t.Fatalf("events after a second run = %s", got)
	}
}

func TestCleanRemovedHubPostsResumesAfterTheCursorIntegration(t *testing.T) {
	f := newPostsFixture(t)
	owner := f.newUser()
	post := f.newPost(owner, true)
	f.exec(`INSERT INTO vetchium.hub_post_replies (post_id, reply_id, author_hub_user_did,
            author_handle, author_tenant_id, body)
        SELECT $1, md5(i::text || $1) || substr(md5($1 || i::text), 1, 8),
            ('01987aef-1234-7abc-8abc-' || lpad(i::text, 12, '0'))::uuid,
            'replier', 'sgp', 'copy'
        FROM generate_series(1, 150) AS i`, post)
	// A crash left the cursor after the first 100 authors.
	f.exec(`UPDATE vetchium.hub_posts
        SET cleanup_author_cursor = '01987aef-1234-7abc-8abc-000000000100'
        WHERE post_id = $1`, post)
	t.Cleanup(func() {
		f.exec(`DELETE FROM vetchium.federation_outbox WHERE aggregate_id = $1`, post)
	})
	// Only the authors after the cursor are enqueued, in one commit that
	// does not finish the post.
	if done, err := f.worker().cleanHubPostPage(f.ctx, post); err != nil || done {
		t.Fatalf("page = %v, %v", done, err)
	}
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE aggregate_id = $1`, post); got != "50" {
		t.Fatalf("events = %s", got)
	}
}
