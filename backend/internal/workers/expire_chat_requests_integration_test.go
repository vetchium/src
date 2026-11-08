package workers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
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

	// contact seeds a Contact of the person hubDID without notes or a
	// conversation, last active age ago.
	contact := func(age string) pgtype.UUID {
		t.Helper()
		person := newID()
		exec(`INSERT INTO vetchium.org_contacts (org_did, hub_user_did,
            display_name, handle, created_by, created_at, last_activity_at)
            VALUES ($1, $2, 'Ada Lovelace', $3, $4, now() - $5::interval,
                now() - $5::interval)`,
			orgDID, person, contactHandle(person), userID, age)
		return person
	}
	// request seeds the person's pending request, sent age ago, as the
	// Contact's first.
	request := func(person pgtype.UUID, age string) pgtype.UUID {
		t.Helper()
		exec(`UPDATE vetchium.org_contacts SET last_request_number = 1
            WHERE org_did = $1 AND hub_user_did = $2`, orgDID, person)
		exec(`INSERT INTO vetchium.org_chat_requests (org_did, hub_user_did,
                request_number, direction, state, consumer_domain,
                opening_number, note, sender_display_name, window_seconds,
                sent_at)
            VALUES ($1, $2, 1, 'to_agency', 'pending', 'client.example', 3,
                'I would like this role', 'Ada Lovelace', 86400,
                now() - $3::interval)`, orgDID, person, age)
		return person
	}
	senderBlock := func(person pgtype.UUID, until string) {
		t.Helper()
		exec(`UPDATE vetchium.org_contacts
            SET hub_requests_blocked_until = now() + $3::interval
            WHERE org_did = $1 AND hub_user_did = $2`, orgDID, person, until)
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

	state := func(person pgtype.UUID) string {
		return scalar(`SELECT r.state || ':' || (r.note IS NULL)::text || ':' ||
                (r.answered_at IS NOT NULL)::text || ':' ||
                (SELECT count(*) FROM vetchium.org_chat_request_opening_blocks AS b
                    WHERE b.org_did = r.org_did
                      AND b.hub_user_did = r.hub_user_did)::text || ':' ||
                (c.hub_requests_blocked_until IS NOT NULL)::text
            FROM vetchium.org_chat_requests AS r
            JOIN vetchium.org_contacts AS c USING (org_did, hub_user_did)
            WHERE r.org_did = $1 AND r.hub_user_did = $2
              AND r.request_number = 1`, orgDID, person)
	}
	if got := state(due); got != "expired:true:true:0:false" {
		t.Fatalf("request past 14 days = %s", got)
	}
	if got := state(waiting); got != "pending:false:false:0:false" {
		t.Fatalf("request within 14 days = %s", got)
	}
	if got := scalar(`SELECT actor_type || ':' || (payload ? 'note')::text
        FROM vetchium.audit_events
        WHERE action = 'org.chat_request.expired' AND entity_id = $1`,
		contactHandle(due)); got != "worker:false" {
		t.Fatalf("expiry audit = %s", got)
	}
	var body []byte
	if err := owner.QueryRow(ctx, `SELECT payload_bytes
        FROM vetchium.federation_outbox
        WHERE kind = 'agency-pointer-changed' AND aggregate_id = $1
        ORDER BY aggregate_version DESC LIMIT 1`,
		pairID(orgDID, due)).Scan(&body); err != nil {
		t.Fatal(err)
	}
	var pointer federationspec.AgencyPointerChangedPayload
	if err := json.Unmarshal(body, &pointer); err != nil || pointer.Request == nil ||
		pointer.Request.State != contacts.ChatRequestExpired ||
		pointer.Request.BlockedUntil != nil || pointer.NewAgencyRequest {
		t.Fatalf("expiry pointer = %s, %v", body, err)
	}

	blocked := func(person pgtype.UUID) string {
		return scalar(`SELECT (hub_requests_blocked_until IS NOT NULL)::text
            FROM vetchium.org_contacts
            WHERE org_did = $1 AND hub_user_did = $2`, orgDID, person)
	}
	if got := blocked(lifted); got != "false" {
		t.Fatalf("a lifted block remains: %s", got)
	}
	if got := blocked(standing); got != "true" {
		t.Fatalf("a standing block was deleted: %s", got)
	}
	if got := scalar(`SELECT count(*)::text FROM vetchium.audit_events
        WHERE action = 'org.chat_request_block.lifted' AND entity_id = $1`,
		contactHandle(lifted)); got != "1" {
		t.Fatalf("lift audit events = %s", got)
	}
	if got := scalar(`SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE kind = 'agency-pointer-changed' AND aggregate_id = $1`,
		pairID(orgDID, lifted)); got != "1" {
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

func TestRetentionOfContactsWithRequestsOrBlocksIntegration(t *testing.T) {
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
	contact := func() pair {
		t.Helper()
		person := newID()
		exec(`INSERT INTO vetchium.org_contacts (org_did, hub_user_did,
            display_name, handle, created_by, created_at, last_activity_at)
            VALUES ($1, $2, 'Ada Lovelace', $3, $4,
                now() - interval '731 days', now() - interval '731 days')`,
			orgDID, person, contactHandle(person), userID)
		return pair{orgDID, person}
	}
	pending, opening, sender, expired, bare := contact(), contact(), contact(),
		contact(), contact()
	for id, state := range map[pair]string{pending: "pending", expired: "expired"} {
		exec(`UPDATE vetchium.org_contacts SET last_request_number = 1
            WHERE org_did = $1 AND hub_user_did = $2`, id.orgDID, id.hubDID)
		exec(`INSERT INTO vetchium.org_chat_requests (org_did, hub_user_did,
                request_number, direction, state, consumer_domain,
                opening_number, sender_display_name, window_seconds, sent_at,
                answered_at)
            VALUES ($1, $2, 1, 'to_agency', $3::text, 'client.example', 3,
                'Ada Lovelace', 86400, now() - interval '731 days',
                CASE WHEN $3::text = 'pending' THEN NULL
                    ELSE now() - interval '731 days' END)`,
			id.orgDID, id.hubDID, state)
	}
	exec(`INSERT INTO vetchium.org_chat_request_opening_blocks (org_did,
            hub_user_did, blocked_direction, consumer_domain, opening_number)
        VALUES ($1, $2, 'to_agency', 'client.example', 3)`,
		opening.orgDID, opening.hubDID)
	exec(`UPDATE vetchium.org_contacts
        SET hub_requests_blocked_until = now() + interval '1 day'
        WHERE org_did = $1 AND hub_user_did = $2`, sender.orgDID, sender.hubDID)

	listed, err := sqlc.New(owner).ListOrgContactsDueForRetention(ctx, 100000)
	if err != nil {
		t.Fatal(err)
	}
	due := map[pair]bool{}
	for _, row := range listed {
		due[pair{row.OrgDid, row.HubUserDid}] = true
	}
	// A pending request or a block keeps a Contact without notes or a
	// conversation (MKT-REQ-012).
	for name, id := range map[string]pair{
		"pending request": pending, "opening block": opening,
		"sender block": sender,
	} {
		if _, err := sqlc.New(app).DeleteUnusedOrgContact(ctx,
			sqlc.DeleteUnusedOrgContactParams{
				OrgDid: id.orgDID, HubUserDid: id.hubDID, TenantID: "usa1",
				ActorType: "worker", ActorID: "test", Source: "test",
			}); !errors.Is(err, pgx.ErrNoRows) {
			t.Errorf("%s: deleted as unused: %v", name, err)
		}
	}
	// Retention waits out a pending request and a live `sender` block, which
	// the expiry worker ends; an `opening` block goes with the Contact.
	for name, id := range map[string]pair{
		"pending request": pending, "sender block": sender,
	} {
		if due[id] {
			t.Errorf("%s: listed for retention", name)
		}
		if done, err := retainContact(ctx, app, "usa1", id); err != nil || done {
			t.Errorf("%s: retained = %t, %v", name, done, err)
		}
	}
	for name, id := range map[string]pair{
		"opening block": opening, "expired request only": expired,
		"nothing": bare,
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
        WHERE org_did = $1`, orgDID).Scan(&kept); err != nil || kept != "2" {
		t.Fatalf("Contacts kept = %s, %v", kept, err)
	}
	var blocks string
	if err := owner.QueryRow(ctx, `SELECT count(*)::text
        FROM vetchium.org_chat_request_opening_blocks
        WHERE org_did = $1`, orgDID).Scan(&blocks); err != nil || blocks != "0" {
		t.Fatalf("opening blocks kept = %s, %v", blocks, err)
	}
}

// contactHandle is a Hub handle unique to the person, as Contacts of one
// agency need.
func contactHandle(person pgtype.UUID) string {
	digits := strings.ReplaceAll(dbvalue.FormatUUID(person), "-", "")
	return digits[13:21] + "-" + digits[21:]
}

func pairID(orgDID, hubDID pgtype.UUID) string {
	return federationspec.ContactAggregateID(
		orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
		hub.HubUserDID(dbvalue.FormatUUID(hubDID)))
}
