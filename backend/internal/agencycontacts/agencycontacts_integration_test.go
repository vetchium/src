package agencycontacts

import (
	"context"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/events"
)

type fixture struct {
	owner, app *pgxpool.Pool
	receiver   *events.Receiver
	userID     pgtype.UUID
}

func newID(t *testing.T) pgtype.UUID {
	t.Helper()
	id, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return id
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
	registry := events.NewRegistry()
	RegisterEvents(registry)
	return &fixture{
		owner: owner, app: app,
		receiver: events.NewReceiver(events.ReceiverConfig{
			Pool: app, TenantID: "usa1", Source: "test", Registry: registry,
		}),
	}
}

func (f *fixture) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.owner.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) scalar(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var value string
	if err := f.owner.QueryRow(context.Background(), sql, args...).
		Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

// agency seeds an active Org with one user and removes it afterwards; it
// returns the Org's DID and sets f.userID.
func (f *fixture) agency(t *testing.T) pgtype.UUID {
	t.Helper()
	orgDID, userID := newID(t), newID(t)
	text := dbvalue.FormatUUID(orgDID)
	f.exec(t, `INSERT INTO vetchium.orgs (org_did, display_name, country,
        default_language, org_state, org_plan_oid)
        VALUES ($1, 'Talent Scouts', 'DE', 'de-DE', 'active', 'org-free-tier')`,
		orgDID)
	f.exec(t, `INSERT INTO vetchium.org_users (org_user_id, org_did,
        email_address, org_user_state, preferred_language)
        VALUES ($1, $2, $3, 'active', 'de-DE')`,
		userID, orgDID, "scout-"+text[len(text)-12:]+"@contacts.example")
	f.exec(t, `INSERT INTO vetchium.org_domains (org_did, domain,
        verification_token, last_verified_at, last_conclusive_at,
        next_check_at)
        VALUES ($1, $2, 'abcdefghijklmnopqrstuvwxyz', now(), now(),
            now() + interval '1 day')`,
		orgDID, "scouts-"+text[len(text)-12:]+".example")
	t.Cleanup(func() {
		ctx := context.Background()
		for _, sql := range []string{
			`DELETE FROM vetchium.org_conversations WHERE org_did = $1`,
			// Notes and Contacts reference the Org's users, also from another
			// agency's Contacts that f.contact seeded with f.userID; requests
			// and blocks go with their Contacts.
			`DELETE FROM vetchium.org_contacts WHERE org_did = $1
             OR created_by IN (SELECT org_user_id FROM vetchium.org_users
                 WHERE org_did = $1)`,
			`DELETE FROM vetchium.federation_outbox
             WHERE convert_from(payload_bytes, 'UTF8')::jsonb
                 ->> 'agency_org_did' = $1::text`,
			`DELETE FROM vetchium.audit_events WHERE subject_org_did = $1`,
			`DELETE FROM vetchium.orgs WHERE org_did = $1`,
		} {
			if _, err := f.owner.Exec(ctx, sql, orgDID); err != nil {
				t.Errorf("clean up: %v", err)
			}
		}
	})
	f.userID = userID
	return orgDID
}

// pair names a Contact: the agency and the person, whose handle the seed
// derives from their DID.
type pair struct {
	org, hub pgtype.UUID
	handle   string
}

func (c pair) id() string {
	return federationspec.ContactAggregateID(
		orgs.OrgDID(dbvalue.FormatUUID(c.org)), hub.HubUserDID(dbvalue.FormatUUID(c.hub)))
}

func handleOf(did pgtype.UUID) string {
	digits := strings.ReplaceAll(dbvalue.FormatUUID(did), "-", "")
	return digits[13:21] + "-" + digits[21:]
}

// contact seeds the agency's Contact of the person with one note and,
// optionally, a conversation.
func (f *fixture) contact(
	t *testing.T, orgDID, hubDID pgtype.UUID, conversation bool,
) pair {
	t.Helper()
	c := pair{org: orgDID, hub: hubDID, handle: handleOf(hubDID)}
	f.exec(t, `INSERT INTO vetchium.org_contacts (org_did, hub_user_did,
        display_name, handle, created_by, last_note_number)
        VALUES ($1, $2, 'Ada Lovelace', $3, $4, 1)`,
		orgDID, hubDID, c.handle, f.userID)
	f.exec(t, `INSERT INTO vetchium.org_contact_notes (org_did, hub_user_did,
        note_number, author_id, note_text)
        VALUES ($1, $2, 1, $3, 'Met at a meetup')`,
		orgDID, hubDID, f.userID)
	if conversation {
		f.exec(t, `INSERT INTO vetchium.org_conversations (org_did,
            hub_user_did, recorded_hub_user_name, recorded_hub_user_handle,
            recorded_agency_name, recorded_agency_domain)
            VALUES ($1, $2, 'Ada Lovelace', $3, 'Talent Scouts',
                'scouts.example')`,
			orgDID, hubDID, c.handle)
	}
	return c
}

func (f *fixture) accountDeleted(t *testing.T, orgDID, hubDID pgtype.UUID) {
	t.Helper()
	payload, err := json.Marshal(federationspec.HubAccountDeletedPayload{
		HubUserDID: hub.HubUserDID(dbvalue.FormatUUID(hubDID)),
	})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := f.receiver.Receive(context.Background(), events.Event{
		EventID: newID(t), SourceTenantID: "usa1",
		Kind: federationspec.HubAccountDeletedKind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalOrg, DID: orgDID,
		},
		AggregateType:    federationspec.HubAccountAggregate,
		AggregateID:      dbvalue.FormatUUID(hubDID),
		AggregateVersion: 1, Payload: payload,
	})
	if err != nil || outcome != federationspec.EventApplied {
		t.Fatalf("receive = %q, %v", outcome, err)
	}
}

func TestAccountDeletionKeepsOnlyConversationsIntegration(t *testing.T) {
	f := newFixture(t)
	agency, other := f.agency(t), f.agency(t)
	gone, kept := newID(t), newID(t)
	talking := f.contact(t, agency, gone, true)
	notesOnly := f.contact(t, other, gone, false)
	unrelated := f.contact(t, agency, kept, false)

	f.accountDeleted(t, agency, gone)

	if got := f.scalar(t, `SELECT (SELECT count(*) FROM vetchium.org_contacts
            WHERE org_did = $1 AND hub_user_did = $2)::text || ':' ||
        (SELECT count(*) FROM vetchium.org_contact_notes
            WHERE org_did = $1 AND hub_user_did = $2)::text || ':' ||
        (SELECT read_only_reason || ':' || (party_deleted_at IS NOT NULL)::text
            FROM vetchium.org_conversations
            WHERE org_did = $1 AND hub_user_did = $2)`,
		talking.org, talking.hub); got != "1:0:hub_user_deleted:true" {
		t.Fatalf("contact with a conversation = %s", got)
	}
	// Another agency hears its own notice; this one changes nothing there.
	if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.org_contact_notes
        WHERE (org_did, hub_user_did) IN (($1, $2), ($3, $4))`,
		notesOnly.org, notesOnly.hub, unrelated.org, unrelated.hub); got != "2" {
		t.Fatalf("other notes = %s", got)
	}

	f.accountDeleted(t, other, gone)
	if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.org_contacts
        WHERE org_did = $1 AND hub_user_did = $2`, notesOnly.org, notesOnly.hub); got != "0" {
		t.Fatalf("contact without a conversation = %s", got)
	}
}

func TestSyncPointerSupersedesEveryEarlierEventIntegration(t *testing.T) {
	f := newFixture(t)
	agency := f.agency(t)
	hubDID := newID(t)
	c := f.contact(t, agency, hubDID, true)
	f.exec(t, `INSERT INTO vetchium.org_conversation_messages (org_did,
            hub_user_did, message_number, sender_type, sender_user_id,
            sender_display_name, kind, consumer_domain, opening_number)
        VALUES ($1, $2, 1, 'agency', $3, 'scout@contacts.example',
            'suggestion', 'client.example', 3)`,
		c.org, c.hub, f.userID)
	start, err := strconv.ParseInt(f.scalar(t, `SELECT pointer_version::text
        FROM vetchium.org_contacts WHERE org_did = $1 AND hub_user_did = $2`,
		c.org, c.hub), 10, 64)
	if err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	for range 2 {
		tx, err := f.owner.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := SyncPointer(ctx, sqlc.New(tx), c.org, c.hub, NoNotice); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := f.owner.Query(ctx, `SELECT aggregate_version, payload_bytes
        FROM vetchium.federation_outbox
        WHERE kind = 'agency-pointer-changed' AND aggregate_id = $1
        ORDER BY aggregate_version`, c.id())
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var versions []int64
	for rows.Next() {
		var version int64
		var body []byte
		if err := rows.Scan(&version, &body); err != nil {
			t.Fatal(err)
		}
		var payload federationspec.AgencyPointerChangedPayload
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatal(err)
		}
		if !payload.Present || !payload.HasConversation ||
			payload.AgencyDisplayName != "Talent Scouts" ||
			len(payload.Suggestions) != 1 ||
			payload.Suggestions[0].SentAt.IsZero() {
			t.Fatalf("payload = %+v", payload)
		}
		versions = append(versions, version)
	}
	if len(versions) != 2 || versions[0] != start+1 || versions[1] != start+2 {
		t.Fatalf("versions = %v", versions)
	}
}
