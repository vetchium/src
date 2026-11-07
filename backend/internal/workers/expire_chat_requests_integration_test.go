package workers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// The stack's own workers share the database and may run the job first;
// either way the outcome below must hold.
func TestExpireChatRequestsIntegration(t *testing.T) {
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
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
	defer app.Close()

	newID := func() pgtype.UUID {
		id, err := dbvalue.NewUUIDv7(time.Now())
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := owner.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	scalar := func(sql string, args ...any) string {
		t.Helper()
		var value string
		if err := owner.QueryRow(ctx, sql, args...).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	orgDID, userID, hubDID := newID(), newID(), newID()
	text, hubText := dbvalue.FormatUUID(orgDID), dbvalue.FormatUUID(hubDID)
	defer func() {
		for _, statement := range []struct {
			sql string
			arg pgtype.UUID
		}{
			{`DELETE FROM vetchium.federation_outbox
             WHERE convert_from(payload_bytes, 'UTF8')::jsonb
                 ->> 'agency_org_did' = $1::text`, orgDID},
			{`DELETE FROM vetchium.audit_events WHERE subject_org_did = $1`, orgDID},
			{`DELETE FROM vetchium.audit_events WHERE subject_hub_user_did = $1`, hubDID},
			{`DELETE FROM vetchium.orgs WHERE org_did = $1`, orgDID},
			{`DELETE FROM vetchium.hub_users WHERE hub_user_did = $1`, hubDID},
		} {
			if _, err := owner.Exec(ctx, statement.sql, statement.arg); err != nil {
				t.Errorf("clean up: %v", err)
			}
		}
	}()
	exec(`INSERT INTO vetchium.orgs (org_did, display_name, country,
        default_language, org_state, org_plan_oid)
        VALUES ($1, 'Chat Expiry', 'DE', 'de-DE', 'active', 'org-free-tier')`,
		orgDID)
	exec(`INSERT INTO vetchium.org_users (org_user_id, org_did, email_address,
        org_user_state, preferred_language)
        VALUES ($1, $2, $3, 'active', 'de-DE')`,
		userID, orgDID, "scout-"+text[len(text)-12:]+"@expiry.example")
	exec(`INSERT INTO vetchium.org_domains (org_did, domain,
        verification_token, last_verified_at, last_conclusive_at,
        next_check_at)
        VALUES ($1, $2, 'abcdefghijklmnopqrstuvwxyz', now(), now(),
            now() + interval '1 day')`,
		orgDID, "expiry-"+text[len(text)-12:]+".example")
	exec(`INSERT INTO vetchium.hub_users (hub_user_did, handle, email_address,
        email_digest, display_name, password_hash, resident_country,
        hub_plan_oid)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')), 'Ada Lovelace',
            'test-hash', 'DE', 'hub-free-tier')`,
		hubDID, "chatexpy-"+hubText[len(hubText)-11:],
		"ada-"+hubText[len(hubText)-12:]+"@expiry.example")

	// contact seeds a Contact without notes or a conversation, last active
	// age ago.
	contact := func(age string) pgtype.UUID {
		t.Helper()
		id := newID()
		exec(`INSERT INTO vetchium.org_contacts (contact_id, org_did,
            hub_user_did, display_name, handle, created_by, created_at,
            last_activity_at)
            VALUES ($1, $2, $3, 'Ada Lovelace', 'abcd1234-0123456789a', $4,
                now() - $5::interval, now() - $5::interval)`,
			id, orgDID, newID(), userID, age)
		return id
	}
	request := func(contactID pgtype.UUID, age string) pgtype.UUID {
		t.Helper()
		id := newID()
		exec(`INSERT INTO vetchium.org_chat_requests (request_id, contact_id,
                org_did, hub_user_did, direction, state, consumer_domain,
                opening_number, note, sender_display_name, window_seconds,
                sent_at)
            SELECT $2, contact_id, org_did, hub_user_did, 'to_agency',
                'pending', 'client.example', 3, 'I would like this role',
                'Ada Lovelace', 86400, now() - $3::interval
            FROM vetchium.org_contacts WHERE contact_id = $1`,
			contactID, id, age)
		return id
	}
	senderBlock := func(contactID pgtype.UUID, until string) {
		t.Helper()
		exec(`INSERT INTO vetchium.org_chat_request_blocks (contact_id,
                blocked_direction, scope, blocked_until, created_at)
            VALUES ($1, 'to_agency', 'sender', now() + $2::interval,
                now() - interval '30 days')`, contactID, until)
	}

	due := request(contact("15 days"), "14 days 1 minute")
	waiting := request(contact("14 days"), "13 days 23 hours")
	lifted, standing := contact("3 days"), contact("3 days")
	senderBlock(lifted, "-1 second")
	senderBlock(standing, "1 day")
	exec(`INSERT INTO vetchium.org_chat_request_creations (org_did,
            created_on, created)
        VALUES ($1, current_date - 3, 5), ($1, current_date, 2)`, orgDID)
	exec(`INSERT INTO vetchium.hub_chat_request_creations (hub_user_did,
            created_on, created)
        VALUES ($1, current_date - 3, 5), ($1, current_date, 2)`, hubDID)

	worker := &Worker{
		queries: sqlc.New(app), chatRequestExpiryDB: app, tenantID: "usa1",
		log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if err := worker.expireChatRequests(ctx); err != nil {
		t.Fatal(err)
	}

	state := func(requestID pgtype.UUID) string {
		return scalar(`SELECT state || ':' || (note IS NULL)::text || ':' ||
                (answered_at IS NOT NULL)::text || ':' ||
                (SELECT count(*) FROM vetchium.org_chat_request_blocks AS b
                    WHERE b.contact_id = r.contact_id)::text
            FROM vetchium.org_chat_requests AS r WHERE request_id = $1`,
			requestID)
	}
	if got := state(due); got != "expired:true:true:0" {
		t.Fatalf("request past 14 days = %s", got)
	}
	if got := state(waiting); got != "pending:false:false:0" {
		t.Fatalf("request within 14 days = %s", got)
	}
	if got := scalar(`SELECT actor_type || ':' || (payload ? 'note')::text
        FROM vetchium.audit_events
        WHERE action = 'org.chat_request.expired' AND entity_id = $1`,
		dbvalue.FormatUUID(due)); got != "worker:false" {
		t.Fatalf("expiry audit = %s", got)
	}
	var body []byte
	if err := owner.QueryRow(ctx, `SELECT o.payload_bytes
        FROM vetchium.federation_outbox AS o
        JOIN vetchium.org_chat_requests AS r
            ON o.aggregate_id = r.contact_id::text
        WHERE o.kind = 'agency-pointer-changed' AND r.request_id = $1
        ORDER BY o.aggregate_version DESC LIMIT 1`, due).Scan(&body); err != nil {
		t.Fatal(err)
	}
	var pointer federationspec.AgencyPointerChangedPayload
	if err := json.Unmarshal(body, &pointer); err != nil || pointer.Request == nil ||
		pointer.Request.State != contacts.ChatRequestExpired ||
		pointer.Request.BlockedUntil != nil || pointer.NewAgencyRequest {
		t.Fatalf("expiry pointer = %s, %v", body, err)
	}

	blocks := func(contactID pgtype.UUID) string {
		return scalar(`SELECT count(*)::text
            FROM vetchium.org_chat_request_blocks WHERE contact_id = $1`,
			contactID)
	}
	if got := blocks(lifted); got != "0" {
		t.Fatalf("a lifted block remains: %s", got)
	}
	if got := blocks(standing); got != "1" {
		t.Fatalf("a standing block was deleted: %s", got)
	}
	if got := scalar(`SELECT count(*)::text FROM vetchium.audit_events
        WHERE action = 'org.chat_request_block.lifted' AND entity_id = $1`,
		dbvalue.FormatUUID(lifted)); got != "1" {
		t.Fatalf("lift audit events = %s", got)
	}
	if got := scalar(`SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE kind = 'agency-pointer-changed' AND aggregate_id = $1`,
		dbvalue.FormatUUID(lifted)); got != "1" {
		t.Fatalf("lift pointer events = %s", got)
	}

	if got := scalar(`SELECT
            (SELECT string_agg((current_date - created_on)::text, ',')
             FROM vetchium.org_chat_request_creations WHERE org_did = $1)
            || ':' ||
            (SELECT string_agg((current_date - created_on)::text, ',')
             FROM vetchium.hub_chat_request_creations WHERE hub_user_did = $2)`,
		orgDID, hubDID); got != "0:0" {
		t.Fatalf("creation days kept = %s", got)
	}
}

func TestRetentionKeepsContactsWithRequestsOrBlocksIntegration(t *testing.T) {
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
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
	defer app.Close()

	newID := func() pgtype.UUID {
		id, err := dbvalue.NewUUIDv7(time.Now())
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := owner.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	orgDID, userID := newID(), newID()
	text := dbvalue.FormatUUID(orgDID)
	defer func() {
		for _, sql := range []string{
			`DELETE FROM vetchium.federation_outbox
             WHERE convert_from(payload_bytes, 'UTF8')::jsonb
                 ->> 'agency_org_did' = $1::text`,
			`DELETE FROM vetchium.audit_events WHERE subject_org_did = $1`,
			`DELETE FROM vetchium.orgs WHERE org_did = $1`,
		} {
			if _, err := owner.Exec(ctx, sql, orgDID); err != nil {
				t.Errorf("clean up: %v", err)
			}
		}
	}()
	exec(`INSERT INTO vetchium.orgs (org_did, display_name, country,
        default_language, org_state, org_plan_oid)
        VALUES ($1, 'Chat Retention', 'DE', 'de-DE', 'active', 'org-free-tier')`,
		orgDID)
	exec(`INSERT INTO vetchium.org_users (org_user_id, org_did, email_address,
        org_user_state, preferred_language)
        VALUES ($1, $2, $3, 'active', 'de-DE')`,
		userID, orgDID, "scout-"+text[len(text)-12:]+"@retention.example")
	exec(`INSERT INTO vetchium.org_domains (org_did, domain,
        verification_token, last_verified_at, last_conclusive_at,
        next_check_at)
        VALUES ($1, $2, 'abcdefghijklmnopqrstuvwxyz', now(), now(),
            now() + interval '1 day')`,
		orgDID, "retention-"+text[len(text)-12:]+".example")

	// Each Contact was last active past the 730-day retention and has
	// neither notes nor a conversation.
	contact := func() pgtype.UUID {
		t.Helper()
		id := newID()
		exec(`INSERT INTO vetchium.org_contacts (contact_id, org_did,
            hub_user_did, display_name, handle, created_by, created_at,
            last_activity_at)
            VALUES ($1, $2, $3, 'Ada Lovelace', 'abcd1234-0123456789a', $4,
                now() - interval '731 days', now() - interval '731 days')`,
			id, orgDID, newID(), userID)
		return id
	}
	pending, opening, sender, expired, bare := contact(), contact(), contact(),
		contact(), contact()
	for id, state := range map[pgtype.UUID]string{pending: "pending", expired: "expired"} {
		exec(`INSERT INTO vetchium.org_chat_requests (request_id, contact_id,
                org_did, hub_user_did, direction, state, consumer_domain,
                opening_number, sender_display_name, window_seconds, sent_at,
                answered_at)
            SELECT $2, contact_id, org_did, hub_user_did, 'to_agency', $3,
                'client.example', 3, 'Ada Lovelace', 86400,
                now() - interval '731 days',
                CASE WHEN $3 = 'pending' THEN NULL
                    ELSE now() - interval '731 days' END
            FROM vetchium.org_contacts WHERE contact_id = $1`,
			id, newID(), state)
	}
	exec(`INSERT INTO vetchium.org_chat_request_blocks (contact_id,
            blocked_direction, scope, consumer_domain, opening_number)
        VALUES ($1, 'to_agency', 'opening', 'client.example', 3)`, opening)
	exec(`INSERT INTO vetchium.org_chat_request_blocks (contact_id,
            blocked_direction, scope, blocked_until, created_at)
        VALUES ($1, 'to_agency', 'sender', now() + interval '1 day',
            now() - interval '1 day')`, sender)

	listed, err := sqlc.New(owner).ListOrgContactsDueForRetention(ctx, 100000)
	if err != nil {
		t.Fatal(err)
	}
	due := map[pgtype.UUID]bool{}
	for _, id := range listed {
		due[id] = true
	}
	for name, id := range map[string]pgtype.UUID{
		"pending request": pending, "opening block": opening,
		"sender block": sender,
	} {
		if due[id] {
			t.Errorf("%s: listed for retention", name)
		}
		if done, err := retainContact(ctx, app, "usa1", id); err != nil || done {
			t.Errorf("%s: retained = %t, %v", name, done, err)
		}
		if _, err := sqlc.New(app).DeleteUnusedOrgContact(ctx,
			sqlc.DeleteUnusedOrgContactParams{
				ContactID: id, OrgDid: orgDID, TenantID: "usa1",
				ActorType: "worker", ActorID: "test", Source: "test",
			}); !errors.Is(err, pgx.ErrNoRows) {
			t.Errorf("%s: deleted as unused: %v", name, err)
		}
	}
	for name, id := range map[string]pgtype.UUID{
		"expired request only": expired, "nothing": bare,
	} {
		if !due[id] {
			t.Errorf("%s: not listed for retention", name)
		}
		if done, err := retainContact(ctx, app, "usa1", id); err != nil || !done {
			t.Errorf("%s: retained = %t, %v", name, done, err)
		}
	}
	var kept string
	if err := owner.QueryRow(ctx, `SELECT count(*)::text FROM vetchium.org_contacts
        WHERE org_did = $1`, orgDID).Scan(&kept); err != nil || kept != "3" {
		t.Fatalf("Contacts kept = %s, %v", kept, err)
	}
}
