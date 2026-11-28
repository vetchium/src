package hubquotes

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	hubposts "github.com/vetchium/src/typespec/hub/posts"

	"backend/internal/dbvalue"
	"backend/internal/federation/events"
	"backend/internal/postid"
)

type fixture struct {
	t        *testing.T
	ctx      context.Context
	owner    *pgxpool.Pool
	receiver *events.Receiver
	users    []pgtype.UUID
	postIDs  []string
}

func newFixture(t *testing.T) *fixture {
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
	f := &fixture{t: t, ctx: ctx, owner: owner}
	t.Cleanup(f.cleanUp)
	registry := events.NewRegistry()
	RegisterEvents(registry)
	f.receiver = events.NewReceiver(events.ReceiverConfig{
		Pool: app, TenantID: "sgp", Source: "mesh-api", Registry: registry,
	})
	return f
}

func (f *fixture) cleanUp() {
	ctx := context.Background()
	for _, did := range f.users {
		for _, sql := range []string{
			`DELETE FROM vetchium.federation_inbox WHERE destination_principal_did = $1`,
			`DELETE FROM vetchium.hub_users WHERE hub_user_did = $1`,
		} {
			_, _ = f.owner.Exec(ctx, sql, did)
		}
	}
	for _, id := range f.postIDs {
		_, _ = f.owner.Exec(ctx, `DELETE FROM vetchium.federation_event_watermarks
            WHERE aggregate_id = $1`, id)
	}
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.owner.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var value string
	if err := f.owner.QueryRow(f.ctx, sql, args...).Scan(&value); err != nil {
		f.t.Fatal(err)
	}
	return value
}

func (f *fixture) newUser() pgtype.UUID {
	f.t.Helper()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		f.t.Fatal(err)
	}
	raw := hex.EncodeToString(did.Bytes[10:])
	f.exec(`INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')), 'Quoter',
                'test-hash', 'SG', 'hub-free-tier')`,
		did, raw[:8]+"-"+raw[:11], "quotes-"+dbvalue.FormatUUID(did)+"@example.com")
	f.users = append(f.users, did)
	return did
}

func (f *fixture) newID() string {
	f.t.Helper()
	id, err := postid.New()
	if err != nil {
		f.t.Fatal(err)
	}
	f.postIDs = append(f.postIDs, id)
	return id
}

// newPost inserts a live post of owner; set adds a SQL assignment list.
func (f *fixture) newPost(owner pgtype.UUID, set string) string {
	f.t.Helper()
	id := f.newID()
	f.exec(`INSERT INTO vetchium.hub_posts (post_id, author_hub_user_did, kind, body)
        VALUES ($1, $2, 'post', 'a post')`, id, owner)
	if set != "" {
		f.exec(`UPDATE vetchium.hub_posts SET `+set+` WHERE post_id = $1`, id)
	}
	return id
}

func handleOf(did pgtype.UUID) hub.HubHandle {
	raw := hex.EncodeToString(did.Bytes[10:])
	return hub.HubHandle(raw[:8] + "-" + raw[:11])
}

func didOf(did pgtype.UUID) hub.HubUserDID { return hub.HubUserDID(dbvalue.FormatUUID(did)) }

func (f *fixture) deliver(
	kind federationspec.EventKind, destination pgtype.UUID, quote string,
	version int64, payload any,
) federationspec.EventDeliveryOutcome {
	f.t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		f.t.Fatal(err)
	}
	eventID, err := dbvalue.NewUUID()
	if err != nil {
		f.t.Fatal(err)
	}
	outcome, err := f.receiver.Receive(f.ctx, events.Event{
		EventID: eventID, SourceTenantID: "sgp", Kind: kind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalHubUser, DID: destination,
		},
		AggregateType: federationspec.AggregateHubPost, AggregateID: quote,
		AggregateVersion: version, Payload: body,
	})
	if err != nil {
		f.t.Fatal(err)
	}
	return outcome
}

func (f *fixture) quoted(
	owner, quoter pgtype.UUID, target, quote string, version int64,
) federationspec.EventDeliveryOutcome {
	return f.deliver(federationspec.HubPostQuotedKind, owner, quote, version,
		federationspec.HubPostQuotedPayload{
			TargetPostID: hubposts.PostID(target), QuotePostID: hubposts.PostID(quote),
			QuoterHubUserDID: didOf(quoter), QuoterHandle: handleOf(quoter),
			CreatedAt: time.Now().UTC(),
		})
}

func (f *fixture) unquoted(
	owner, quoter pgtype.UUID, target, quote string, version int64,
) federationspec.EventDeliveryOutcome {
	return f.deliver(federationspec.HubPostUnquotedKind, owner, quote, version,
		federationspec.HubPostUnquotedPayload{
			TargetPostID: hubposts.PostID(target), QuotePostID: hubposts.PostID(quote),
			QuoterHubUserDID: didOf(quoter),
		})
}

func (f *fixture) count(post string) string {
	return f.scalar(`SELECT quote_count::text FROM vetchium.hub_posts
        WHERE post_id = $1`, post)
}

func (f *fixture) rows(post string) string {
	return f.scalar(`SELECT count(*)::text || '/' ||
            count(*) FILTER (WHERE detached_at IS NULL)::text
        FROM vetchium.hub_post_quotes WHERE target_post_id = $1`, post)
}

func TestQuotedInsertsAndCountsIntegration(t *testing.T) {
	f := newFixture(t)
	owner, quoter := f.newUser(), f.newUser()
	target := f.newPost(owner, "")
	quote := f.newID()
	if got := f.quoted(owner, quoter, target, quote, 1); got != federationspec.EventApplied {
		t.Fatalf("quoted: %s", got)
	}
	if got := f.count(target); got != "1" {
		t.Fatalf("count = %s", got)
	}
	if got := f.rows(target); got != "1/1" {
		t.Fatalf("rows = %s", got)
	}
	if got := f.scalar(`SELECT quoter_tenant_id FROM vetchium.hub_post_quotes
        WHERE quote_post_id = $1`, quote); got != "sgp" {
		t.Fatalf("tenant hint = %s", got)
	}
}

func TestRefusedQuoteInsertsDetachedWithoutACountIntegration(t *testing.T) {
	f := newFixture(t)
	owner, quoter := f.newUser(), f.newUser()
	closed := f.newPost(owner, `quote_policy = 'nobody'`)
	if got := f.quoted(owner, quoter, closed, f.newID(), 1); got != federationspec.EventApplied {
		t.Fatalf("policy: %s", got)
	}
	if got := f.count(closed) + " " + f.rows(closed); got != "0 1/0" {
		t.Fatalf("policy refusal = %s", got)
	}
	f.exec(`INSERT INTO vetchium.hub_user_blocks (blocker_hub_user_did, blocked_hub_user_did,
            blocked_handle, blocked_tenant_id)
        VALUES ($1, $2, 'quoter', 'sgp')`, owner, quoter)
	open := f.newPost(owner, "")
	f.quoted(owner, quoter, open, f.newID(), 1)
	if got := f.count(open) + " " + f.rows(open); got != "0 1/0" {
		t.Fatalf("block refusal = %s", got)
	}
}

func TestQuotedRecordsNothingForAMissingOrRemovedTargetIntegration(t *testing.T) {
	f := newFixture(t)
	owner, quoter := f.newUser(), f.newUser()
	removed := f.newPost(owner, `state = 'removed', body = NULL, removed_at = now()`)
	f.quoted(owner, quoter, removed, f.newID(), 1)
	if got := f.rows(removed); got != "0/0" {
		t.Fatalf("removed target rows = %s", got)
	}
	f.quoted(owner, quoter, f.newID(), f.newID(), 1)
	elsewhere := f.newPost(f.newUser(), "")
	f.quoted(owner, quoter, elsewhere, f.newID(), 1)
	if got := f.rows(elsewhere); got != "0/0" {
		t.Fatalf("another owner's post rows = %s", got)
	}
}

func TestUnquotedAfterDetachKeepsTheCountIntegration(t *testing.T) {
	f := newFixture(t)
	owner, quoter := f.newUser(), f.newUser()
	target := f.newPost(owner, "")
	attached, detached := f.newID(), f.newID()
	f.quoted(owner, quoter, target, attached, 1)
	f.quoted(owner, quoter, target, detached, 1)
	if got := f.count(target); got != "2" {
		t.Fatalf("count = %s", got)
	}
	// The owner detached one quote and lowered the count.
	f.exec(`UPDATE vetchium.hub_post_quotes SET detached_at = now()
        WHERE quote_post_id = $1`, detached)
	f.exec(`UPDATE vetchium.hub_posts SET quote_count = 1 WHERE post_id = $1`, target)

	if got := f.unquoted(owner, quoter, target, detached, 2); got != federationspec.EventApplied {
		t.Fatalf("unquoted detached: %s", got)
	}
	if got := f.count(target) + " " + f.rows(target); got != "1 1/1" {
		t.Fatalf("after detached unquote = %s", got)
	}
	f.unquoted(owner, quoter, target, attached, 2)
	if got := f.count(target) + " " + f.rows(target); got != "0 0/0" {
		t.Fatalf("after attached unquote = %s", got)
	}
}

func TestUnquotedIgnoresAnotherQuotersRowIntegration(t *testing.T) {
	f := newFixture(t)
	owner, quoter, stranger := f.newUser(), f.newUser(), f.newUser()
	target := f.newPost(owner, "")
	quote := f.newID()
	f.quoted(owner, quoter, target, quote, 1)
	f.unquoted(owner, stranger, target, quote, 2)
	if got := f.count(target) + " " + f.rows(target); got != "1 1/1" {
		t.Fatalf("a stranger's unquote changed %s", got)
	}
}

func TestALateQuotedAfterUnquotedIsSupersededIntegration(t *testing.T) {
	f := newFixture(t)
	owner, quoter := f.newUser(), f.newUser()
	target := f.newPost(owner, "")
	quote := f.newID()
	if got := f.unquoted(owner, quoter, target, quote, 2); got != federationspec.EventApplied {
		t.Fatalf("unquoted: %s", got)
	}
	if got := f.quoted(owner, quoter, target, quote, 1); got != federationspec.EventSuperseded {
		t.Fatalf("late quoted: %s", got)
	}
	if got := f.count(target) + " " + f.rows(target); got != "0 0/0" {
		t.Fatalf("late quoted changed %s", got)
	}
}
