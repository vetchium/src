package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// websiteHarness runs against a migrated disposable tenant database inside a
// transaction that is always rolled back, like the profile lifecycle test.
type websiteHarness struct {
	t   *testing.T
	ctx context.Context
	tx  pgx.Tx
	q   *sqlc.Queries
	did pgtype.UUID
}

func newWebsiteHarness(t *testing.T, handle string) *websiteHarness {
	t.Helper()
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, display_name, password_hash,
         resident_country, hub_plan_oid)
        VALUES ($1, $2, $3, 'Website Test', 'test-hash', 'SG',
                'hub-free-tier')`,
		did, handle,
		fmt.Sprintf("website-test-%s@example.com", dbvalue.FormatUUID(did)),
	); err != nil {
		t.Fatal(err)
	}
	return &websiteHarness{t: t, ctx: ctx, tx: tx, q: sqlc.New(tx), did: did}
}

func (h *websiteHarness) version() int64 {
	h.t.Helper()
	var version int64
	if err := h.tx.QueryRow(h.ctx, `SELECT profile_version
        FROM vetchium.hub_users WHERE hub_user_did = $1`, h.did).Scan(&version); err != nil {
		h.t.Fatal(err)
	}
	return version
}

func (h *websiteHarness) events(action string) int {
	h.t.Helper()
	var count int
	if err := h.tx.QueryRow(h.ctx, `SELECT count(*) FROM vetchium.audit_events
        WHERE action = $1 AND actor_id = $2`, action,
		dbvalue.FormatUUID(h.did)).Scan(&count); err != nil {
		h.t.Fatal(err)
	}
	return count
}

func (h *websiteHarness) rows() int {
	h.t.Helper()
	var count int
	if err := h.tx.QueryRow(h.ctx, `SELECT count(*) FROM vetchium.hub_websites
        WHERE hub_user_did = $1`, h.did).Scan(&count); err != nil {
		h.t.Fatal(err)
	}
	return count
}

type publicWebsite struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

func (h *websiteHarness) public() []publicWebsite {
	h.t.Helper()
	profile, err := h.q.GetHubPublicProfile(h.ctx, h.did)
	if err != nil {
		h.t.Fatal(err)
	}
	var items []publicWebsite
	if err := json.Unmarshal(profile.Websites, &items); err != nil {
		h.t.Fatal(err)
	}
	return items
}

func (h *websiteHarness) create(
	url, tenant, key string,
) (pgtype.UUID, sqlc.CreateHubWebsiteRow, error) {
	h.t.Helper()
	id := profileTestUUID(h.t)
	row, err := h.q.CreateHubWebsite(h.ctx, sqlc.CreateHubWebsiteParams{
		HubUserDid: h.did, WebsiteID: id, WebsiteUrl: url,
		TenantID: tenant, IdempotencyKey: dbvalue.Text(key),
	})
	return id, row, err
}

func (h *websiteHarness) update(
	id pgtype.UUID, url, tenant, key string,
) (sqlc.UpdateHubWebsiteRow, error) {
	h.t.Helper()
	return h.q.UpdateHubWebsite(h.ctx, sqlc.UpdateHubWebsiteParams{
		HubUserDid: h.did, WebsiteID: id, WebsiteUrl: url,
		TenantID: tenant, IdempotencyKey: dbvalue.Text(key),
	})
}

func (h *websiteHarness) remove(
	id pgtype.UUID, tenant, key string,
) (sqlc.DeleteHubWebsiteRow, error) {
	h.t.Helper()
	return h.q.DeleteHubWebsite(h.ctx, sqlc.DeleteHubWebsiteParams{
		HubUserDid: h.did, WebsiteID: id,
		TenantID: tenant, IdempotencyKey: dbvalue.Text(key),
	})
}

// expectFailureRolledBack runs a statement that must fail and returns the
// transaction to its earlier state, as a failed statement aborts it.
func (h *websiteHarness) expectFailureRolledBack(
	what string, statement func() error,
) {
	h.t.Helper()
	if _, err := h.tx.Exec(h.ctx, "SAVEPOINT website_failure"); err != nil {
		h.t.Fatal(err)
	}
	if err := statement(); err == nil {
		h.t.Fatalf("%s unexpectedly succeeded", what)
	}
	if _, err := h.tx.Exec(h.ctx, "ROLLBACK TO SAVEPOINT website_failure"); err != nil {
		h.t.Fatal(err)
	}
	if _, err := h.tx.Exec(h.ctx, "RELEASE SAVEPOINT website_failure"); err != nil {
		h.t.Fatal(err)
	}
}

func TestHubWebsiteLifecycleIntegration(t *testing.T) {
	h := newWebsiteHarness(t, "pweb1-0123456789a")
	start := h.version()

	githubID, created, err := h.create(
		"https://github.com/octocat", "sgp", "create-github",
	)
	if err != nil || created.ProfileVersion != start+1 ||
		created.WebsiteUrl != "https://github.com/octocat" {
		t.Fatalf("create = %+v, %v", created, err)
	}
	if got := h.public(); len(got) != 1 ||
		got[0].ID != dbvalue.FormatUUID(githubID) ||
		got[0].URL != "https://github.com/octocat" {
		t.Fatalf("public websites = %+v", got)
	}

	// The event names the actor, entity, source and idempotency key, and
	// carries the host and a digest but never the full URL.
	var payload string
	if err := h.tx.QueryRow(h.ctx, `SELECT payload::text
        FROM vetchium.audit_events
        WHERE action = 'hub.profile.website-created'
          AND entity_type = 'hub_website' AND entity_id = $1
          AND actor_type = 'hub_user' AND actor_id = $2
          AND source = 'hub-api' AND tenant_id = 'sgp'
          AND idempotency_key = 'create-github'`,
		dbvalue.FormatUUID(githubID), dbvalue.FormatUUID(h.did),
	).Scan(&payload); err != nil {
		t.Fatalf("created audit event: %v", err)
	}
	if !strings.Contains(payload, `"host": "github.com"`) ||
		!strings.Contains(payload, "website_url_sha256") ||
		!strings.Contains(payload, `"profile_version": 2`) ||
		strings.Contains(payload, "octocat") {
		t.Fatalf("created audit payload = %s", payload)
	}

	// A URL the owner already lists changes nothing and audits nothing.
	if _, _, err := h.create(
		"https://github.com/octocat", "sgp", "create-duplicate",
	); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("duplicate create error = %v, want no rows", err)
	}
	if h.version() != start+1 || h.rows() != 1 ||
		h.events("hub.profile.website-created") != 1 {
		t.Fatal("rejected duplicate changed state or wrote an audit event")
	}

	// A second website, then updates: the changed flag, the duplicate guard,
	// an unchanged URL, and an entry that is not the owner's.
	blogID, _, err := h.create("https://blog.example.org", "sgp", "create-blog")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := h.update(
		blogID, "https://blog.example.org/posts", "sgp", "update-blog",
	)
	if err != nil || updated.WebsiteUrl != "https://blog.example.org/posts" ||
		updated.ProfileVersion != start+3 {
		t.Fatalf("update = %+v, %v", updated, err)
	}
	assertProfileFieldChange(t, h.ctx, h.tx, "hub.profile.website-updated",
		blogID, "website_url", true)
	if _, err := h.update(
		blogID, "https://github.com/octocat", "sgp", "update-duplicate",
	); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("update to a listed URL error = %v, want no rows", err)
	}
	if _, err := h.update(
		profileTestUUID(t), "https://example.net", "sgp", "update-missing",
	); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("update of a missing entry error = %v, want no rows", err)
	}
	if h.events("hub.profile.website-updated") != 1 ||
		h.version() != start+3 {
		t.Fatal("rejected updates changed state or wrote an audit event")
	}
	if _, err := h.update(
		blogID, "https://blog.example.org/posts", "sgp", "update-unchanged",
	); err != nil {
		t.Fatal(err)
	}
	if h.events("hub.profile.website-updated") != 2 {
		t.Fatal("update did not commit its audit event")
	}

	// Another owner's entry cannot be updated or deleted through this owner.
	stranger := websiteTestOwner(t, h, "pweb2-0123456789a")
	if _, err := stranger.update(
		blogID, "https://stolen.example.org", "sgp", "update-foreign",
	); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("foreign update error = %v, want no rows", err)
	}
	if _, err := stranger.remove(
		blogID, "sgp", "delete-foreign",
	); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("foreign delete error = %v, want no rows", err)
	}

	before := h.version()
	deleted, err := h.remove(githubID, "sgp", "delete-github")
	if err != nil || deleted.ProfileVersion != before+1 {
		t.Fatalf("delete = %+v, %v", deleted, err)
	}
	if got := h.public(); len(got) != 1 ||
		got[0].ID != dbvalue.FormatUUID(blogID) {
		t.Fatalf("public websites after delete = %+v", got)
	}
	if err := h.tx.QueryRow(h.ctx, `SELECT payload::text
        FROM vetchium.audit_events
        WHERE action = 'hub.profile.website-deleted' AND entity_id = $1
          AND actor_id = $2 AND idempotency_key = 'delete-github'`,
		dbvalue.FormatUUID(githubID), dbvalue.FormatUUID(h.did),
	).Scan(&payload); err != nil {
		t.Fatalf("deleted audit event: %v", err)
	}
	if !strings.Contains(payload, `"host": "github.com"`) ||
		strings.Contains(payload, "octocat") {
		t.Fatalf("deleted audit payload = %s", payload)
	}
	if _, err := h.remove(githubID, "sgp", "delete-again"); !errors.Is(
		err, pgx.ErrNoRows,
	) {
		t.Fatalf("second delete error = %v, want no rows", err)
	}
	if h.events("hub.profile.website-deleted") != 1 {
		t.Fatal("repeated delete wrote a second audit event")
	}
}

// websiteTestOwner adds a second user to the harness's transaction.
func websiteTestOwner(
	t *testing.T, h *websiteHarness, handle string,
) *websiteHarness {
	t.Helper()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.tx.Exec(h.ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, display_name, password_hash,
         resident_country, hub_plan_oid)
        VALUES ($1, $2, $3, 'Other Owner', 'test-hash', 'SG',
                'hub-free-tier')`,
		did, handle,
		fmt.Sprintf("website-other-%s@example.com", dbvalue.FormatUUID(did)),
	); err != nil {
		t.Fatal(err)
	}
	return &websiteHarness{t: t, ctx: h.ctx, tx: h.tx, q: h.q, did: did}
}

func TestHubWebsiteLimitAndConstraintsIntegration(t *testing.T) {
	h := newWebsiteHarness(t, "pweb3-0123456789a")

	// PROF-WEB-004: ten websites fit; the eleventh is refused without state.
	for i := range 10 {
		if _, _, err := h.create(
			fmt.Sprintf("https://site-%d.example.org", i), "sgp",
			fmt.Sprintf("fill-%d", i),
		); err != nil {
			t.Fatalf("website %d: %v", i, err)
		}
	}
	full := h.version()
	if _, _, err := h.create(
		"https://site-10.example.org", "sgp", "over-limit",
	); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("eleventh website error = %v, want no rows", err)
	}
	if h.rows() != 10 || h.version() != full ||
		h.events("hub.profile.website-created") != 10 {
		t.Fatal("refused eleventh website changed state or audit")
	}
	// The trigger, not the guard, keeps the limit for a writer that skips it.
	h.expectFailureRolledBack("insert past the entry limit", func() error {
		_, err := h.tx.Exec(h.ctx, `INSERT INTO vetchium.hub_websites
            (hub_user_did, website_url)
            VALUES ($1, 'https://site-11.example.org')`, h.did)
		return err
	})

	// The constraints reject every non-normalized or unsafe shape on their
	// own, for a writer that skips the API's validation.
	fresh := websiteTestOwner(t, h, "pweb4-0123456789a")
	for _, url := range []string{
		"http://example.org",
		"https://Example.org",
		"https://localhost",
		"https://127.0.0.1",
		"https://1.2.3.4:8080/x",
		"https://user:secret@example.org",
		"https://example.org#fragment",
		"https://example.org/a#fragment",
		"https://example.org?x=1",
		"https://example.org/",
		"https://example.org/a b",
		"https://example.org/ü",
		"https://-bad.example.org",
		"https://example..org",
		"https://example.org:123456",
		"https://example.org/" + strings.Repeat("a", 2048),
	} {
		fresh.expectFailureRolledBack("insert of "+url, func() error {
			_, err := fresh.tx.Exec(fresh.ctx, `INSERT INTO vetchium.hub_websites
                (hub_user_did, website_url) VALUES ($1, $2)`, fresh.did, url)
			return err
		})
	}
	for _, url := range []string{
		"https://example.org",
		"https://example.org/?a=1",
		"https://sub.example.co.uk:8443/path/?q=%C3%BC",
		"https://1.2.3.4.example.org/x",
	} {
		if _, err := fresh.tx.Exec(fresh.ctx, `INSERT INTO vetchium.hub_websites
            (hub_user_did, website_url) VALUES ($1, $2)`, fresh.did, url,
		); err != nil {
			t.Fatalf("valid %q rejected: %v", url, err)
		}
	}
	fresh.expectFailureRolledBack("raw duplicate insert", func() error {
		_, err := fresh.tx.Exec(fresh.ctx, `INSERT INTO vetchium.hub_websites
            (hub_user_did, website_url) VALUES ($1, 'https://example.org')`,
			fresh.did)
		return err
	})
}

// Every logical write and its audit event commit together or not at all.
func TestHubWebsiteWritesRollBackWithRejectedAuditIntegration(t *testing.T) {
	h := newWebsiteHarness(t, "pweb5-0123456789a")
	id, _, err := h.create("https://example.org", "sgp", "seed")
	if err != nil {
		t.Fatal(err)
	}
	start := h.version()

	// A blank tenant id makes the audit insert fail.
	h.expectFailureRolledBack("create without an audit event", func() error {
		_, _, err := h.create("https://second.example.org", "", "no-audit")
		return err
	})
	h.expectFailureRolledBack("update without an audit event", func() error {
		_, err := h.update(id, "https://changed.example.org", "", "no-audit")
		return err
	})
	h.expectFailureRolledBack("delete without an audit event", func() error {
		_, err := h.remove(id, "", "no-audit")
		return err
	})

	if h.version() != start || h.rows() != 1 {
		t.Fatalf("rejected audit left version %d and %d rows", h.version(), h.rows())
	}
	if got := h.public(); len(got) != 1 || got[0].URL != "https://example.org" {
		t.Fatalf("public websites = %+v", got)
	}
}

// raceWrites runs first inside an open transaction, starts second in another
// transaction, waits until second is blocked on the owner's row lock, then
// commits first and returns second's error. Both statements therefore read
// their snapshots before either commit, as two simultaneous requests would.
func raceWrites(
	t *testing.T, ctx context.Context, pool *pgxpool.Pool,
	first, second func(*sqlc.Queries) error,
) error {
	t.Helper()
	tx1, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx1.Rollback(ctx) }()
	tx2, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx2.Rollback(ctx) }()
	if err := first(sqlc.New(tx1)); err != nil {
		t.Fatalf("first write: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- second(sqlc.New(tx2)) }()
	deadline := time.Now().Add(10 * time.Second)
	for {
		var waiting int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'`,
		).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting > 0 {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("second write finished before the first committed: %v", err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("second write never blocked on the owner lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := tx1.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return <-done
}

// PROF-WEB-004 must hold when two requests race, not only in sequence. The
// query guards read the statement snapshot, so the unique index and the limit
// trigger are what stop the loser once the winner commits.
func TestHubWebsiteRacingWritesKeepInvariantsIntegration(t *testing.T) {
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM vetchium.audit_events
            WHERE actor_id = $1`, dbvalue.FormatUUID(did))
		_, _ = pool.Exec(ctx, `DELETE FROM vetchium.hub_users
            WHERE hub_user_did = $1`, did)
	}()
	if _, err := pool.Exec(ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, display_name, password_hash,
         resident_country, hub_plan_oid)
        VALUES ($1, 'pweb6-0123456789a', $2, 'Race Test', 'test-hash', 'SG',
                'hub-free-tier')`,
		did, "website-race-"+dbvalue.FormatUUID(did)+"@example.com",
	); err != nil {
		t.Fatal(err)
	}
	create := func(url string) func(*sqlc.Queries) error {
		return func(q *sqlc.Queries) error {
			_, err := q.CreateHubWebsite(ctx, sqlc.CreateHubWebsiteParams{
				HubUserDid: did, WebsiteID: profileTestUUID(t),
				WebsiteUrl: url, TenantID: "sgp",
				IdempotencyKey: dbvalue.Text("race-" + url),
			})
			return err
		}
	}
	count := func() int {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM vetchium.hub_websites
            WHERE hub_user_did = $1`, did).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// Two requests add the same URL: the loser sees the winner's row and is
	// refused with no row rather than an error.
	err = raceWrites(t, ctx, pool,
		create("https://race.example.org"), create("https://race.example.org"))
	if !errors.Is(err, pgx.ErrNoRows) || count() != 1 {
		t.Fatalf("racing duplicate create = %v with %d rows, want no rows and 1",
			err, count())
	}

	// Two requests take the tenth slot: the trigger refuses the loser.
	for i := range 8 {
		if err := create(fmt.Sprintf("https://fill-%d.example.org", i))(
			sqlc.New(pool),
		); err != nil {
			t.Fatal(err)
		}
	}
	err = raceWrites(t, ctx, pool,
		create("https://tenth-a.example.org"), create("https://tenth-b.example.org"))
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" ||
		!strings.HasPrefix(pgErr.Message, "hub_websites profile entry limit") ||
		count() != 10 {
		t.Fatalf("racing tenth create = %v with %d rows", err, count())
	}

	// Two updates move different entries to the same URL: the unique index
	// refuses the loser, and websiteConflict maps it by constraint name.
	var ids []pgtype.UUID
	rows, err := pool.Query(ctx, `SELECT website_id FROM vetchium.hub_websites
        WHERE hub_user_did = $1 ORDER BY website_id LIMIT 2`, did)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id pgtype.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) != 2 {
		t.Fatalf("entries to update = %d", len(ids))
	}
	move := func(id pgtype.UUID) func(*sqlc.Queries) error {
		return func(q *sqlc.Queries) error {
			_, err := q.UpdateHubWebsite(ctx, sqlc.UpdateHubWebsiteParams{
				HubUserDid: did, WebsiteID: id,
				WebsiteUrl: "https://moved.example.org", TenantID: "sgp",
				IdempotencyKey: dbvalue.Text("move-" + dbvalue.FormatUUID(id)),
			})
			return err
		}
	}
	err = raceWrites(t, ctx, pool, move(ids[0]), move(ids[1]))
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" ||
		pgErr.ConstraintName != "hub_websites_user_url_key" {
		t.Fatalf("racing update to a taken URL = %v", err)
	}
	var moved int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vetchium.hub_websites
        WHERE hub_user_did = $1 AND website_url = 'https://moved.example.org'`,
		did).Scan(&moved); err != nil || moved != 1 {
		t.Fatalf("rows at the contested URL = %d, %v", moved, err)
	}
}
