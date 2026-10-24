package agencyconversations

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
)

type fixture struct {
	owner    *pgxpool.Pool
	executor *commands.Executor
	orgDID   pgtype.UUID
	userID   pgtype.UUID
}

func newID(t *testing.T) pgtype.UUID {
	t.Helper()
	id, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// newFixture seeds an active agency Org in usa1 and removes it afterwards.
// Commands come from sgp, which the directory says homes every Hub user.
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
	f := &fixture{owner: owner, orgDID: newID(t), userID: newID(t)}
	text := dbvalue.FormatUUID(f.orgDID)
	f.exec(t, `INSERT INTO vetchium.orgs (org_did, display_name, country,
        default_language, org_state, org_plan_oid)
        VALUES ($1, 'Talent Scouts', 'DE', 'de-DE', 'active', 'org-free-tier')`,
		f.orgDID)
	f.exec(t, `INSERT INTO vetchium.org_users (org_user_id, org_did,
        email_address, org_user_state, preferred_language)
        VALUES ($1, $2, 'scout@conversation.example', 'active', 'de-DE')`,
		f.userID, f.orgDID)
	f.exec(t, `INSERT INTO vetchium.org_domains (org_did, domain,
        verification_token, last_verified_at, last_conclusive_at,
        next_check_at)
        VALUES ($1, $2, 'abcdefghijklmnopqrstuvwxyz', now(), now(),
            now() + interval '1 day')`,
		f.orgDID, "scouts-"+text[len(text)-12:]+".example")
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM vetchium.org_conversations WHERE org_did = $1`,
			`DELETE FROM vetchium.federation_outbox
             WHERE convert_from(payload_bytes, 'UTF8')::jsonb
                 ->> 'agency_org_did' = $1::text`,
			`DELETE FROM vetchium.audit_events WHERE subject_org_did = $1`,
			`DELETE FROM vetchium.orgs WHERE org_did = $1`,
		} {
			_, _ = owner.Exec(ctx, sql, f.orgDID)
		}
	})
	registry := commands.NewRegistry()
	Register(registry)
	f.executor = commands.NewExecutor(commands.ExecutorConfig{
		Pool: app, TenantID: "usa1", Registry: registry, Directory: f,
	})
	return f
}

func (f *fixture) ResolvePrincipal(
	_ context.Context, request directoryspec.ResolvePrincipalRequest,
) (directoryspec.ResolvePrincipalResponse, *problem.Details, error) {
	return directoryspec.ResolvePrincipalResponse{
		PrincipalType: request.PrincipalType,
		PrincipalDID:  request.PrincipalDID, HomeTenantID: "sgp",
		RoutingVersion: 1,
	}, nil, nil
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

// contact seeds a Contact of the agency for hubDID, with notes notes and,
// when conversation is set, a conversation holding one agency suggestion.
func (f *fixture) contact(
	t *testing.T, hubDID pgtype.UUID, notes int, conversation bool,
) pgtype.UUID {
	t.Helper()
	contactID := newID(t)
	f.exec(t, `INSERT INTO vetchium.org_contacts (contact_id, org_did,
        hub_user_did, display_name, handle, created_by)
        VALUES ($1, $2, $3, 'Ada Lovelace', 'abcd1234-0123456789a', $4)`,
		contactID, f.orgDID, hubDID, f.userID)
	for range notes {
		f.exec(t, `INSERT INTO vetchium.org_contact_notes (note_id,
            contact_id, author_id, note_text)
            VALUES (gen_random_uuid(), $1, $2, 'Strong systems background')`,
			contactID, f.userID)
	}
	if conversation {
		conversationID := newID(t)
		f.exec(t, `INSERT INTO vetchium.org_conversations (conversation_id,
            contact_id, org_did, hub_user_did, recorded_hub_user_name,
            recorded_hub_user_handle, recorded_agency_name,
            recorded_agency_domain)
            VALUES ($1, $2, $3, $4, 'Ada Lovelace', 'abcd1234-0123456789a',
                'Talent Scouts', 'scouts.example')`,
			conversationID, contactID, f.orgDID, hubDID)
		f.exec(t, `INSERT INTO vetchium.org_conversation_messages (message_id,
            conversation_id, sender_type, sender_user_id, sender_display_name,
            kind, consumer_domain, opening_number)
            VALUES (gen_random_uuid(), $1, 'agency', $2,
                'scout@conversation.example', 'suggestion', 'client.example', 7)`,
			conversationID, f.userID)
	}
	return contactID
}

func (f *fixture) send(
	t *testing.T, kind federationspec.CommandKind, contactID pgtype.UUID,
	payload any,
) commands.Response {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	commandID := newID(t)
	response, err := f.executor.Execute(context.Background(), commands.Command{
		CommandID: commandID, CorrelationID: commandID, SourceTenantID: "sgp",
		Kind: kind,
		Authority: commands.Principal{
			Type: directoryspec.PrincipalOrg, DID: f.orgDID,
		},
		AggregateID: dbvalue.FormatUUID(contactID), Payload: body,
	})
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func (f *fixture) reply(
	t *testing.T, contactID, hubDID pgtype.UUID, text string,
) commands.Response {
	t.Helper()
	return f.send(t, federationspec.HubConversationReplyKind, contactID,
		federationspec.HubConversationReplyPayload{
			ContactID:          contacts.ContactID(dbvalue.FormatUUID(contactID)),
			HubUserDID:         hub.HubUserDID(dbvalue.FormatUUID(hubDID)),
			HubUserDisplayName: "Ada King",
			HubUserHandle:      "abcd1234-0123456789b",
			Text:               contacts.MessageText(text),
		})
}

func (f *fixture) delete(
	t *testing.T, contactID, hubDID pgtype.UUID,
) commands.Response {
	t.Helper()
	return f.send(t, federationspec.HubConversationDeleteKind, contactID,
		federationspec.HubConversationDeletePayload{
			ContactID:  contacts.ContactID(dbvalue.FormatUUID(contactID)),
			HubUserDID: hub.HubUserDID(dbvalue.FormatUUID(hubDID)),
		})
}

// pointer is the latest agency-pointer-changed event for the Contact.
func (f *fixture) pointer(
	t *testing.T, contactID pgtype.UUID,
) (int64, federationspec.AgencyPointerChangedPayload) {
	t.Helper()
	var version int64
	var body []byte
	if err := f.owner.QueryRow(context.Background(), `SELECT
            aggregate_version, payload_bytes FROM vetchium.federation_outbox
        WHERE kind = 'agency-pointer-changed' AND aggregate_id = $1
        ORDER BY aggregate_version DESC LIMIT 1`,
		dbvalue.FormatUUID(contactID)).Scan(&version, &body); err != nil {
		t.Fatal(err)
	}
	var payload federationspec.AgencyPointerChangedPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	return version, payload
}

func problemType(t *testing.T, response commands.Response) string {
	t.Helper()
	var body struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(response.Body, &body); err != nil {
		t.Fatal(err)
	}
	return strings.TrimPrefix(body.Type, "vetchium-problem-details/")
}

func TestHubReplyRecordsTheMessageAndKeepsSuggestionsIntegration(t *testing.T) {
	f := newFixture(t)
	hubDID := newID(t)
	contactID := f.contact(t, hubDID, 0, true)
	response := f.reply(t, contactID, hubDID, "Happy to talk")
	if response.Status != 200 {
		t.Fatalf("reply = %d %s", response.Status, response.Body)
	}
	if got := f.scalar(t, `SELECT agency_unread_count::text || ':' ||
            recorded_hub_user_name FROM vetchium.org_conversations
        WHERE contact_id = $1`, contactID); got != "1:Ada King" {
		t.Fatalf("conversation = %s", got)
	}
	if got := f.scalar(t, `SELECT display_name || ':' || handle
        FROM vetchium.org_contacts WHERE contact_id = $1`,
		contactID); got != "Ada King:abcd1234-0123456789b" {
		t.Fatalf("contact = %s", got)
	}
	version, payload := f.pointer(t, contactID)
	if version != 2 || !payload.Present || !payload.HasConversation ||
		payload.NewAgencyMessage || len(payload.Suggestions) != 1 ||
		payload.Suggestions[0].ConsumerDomain != "client.example" ||
		payload.Suggestions[0].OpeningNumber != 7 ||
		payload.Suggestions[0].SentAt.IsZero() {
		t.Fatalf("pointer = %d %+v", version, payload)
	}
	second := f.reply(t, contactID, hubDID, "Mornings suit me")
	if second.Status != 200 {
		t.Fatalf("second reply = %d %s", second.Status, second.Body)
	}
	if next, _ := f.pointer(t, contactID); next != 3 {
		t.Fatalf("pointer version = %d, want 3", next)
	}
	if got := f.scalar(t, `SELECT agency_unread_count::text
        FROM vetchium.org_conversations WHERE contact_id = $1`,
		contactID); got != "2" {
		t.Fatalf("unread = %s", got)
	}
}

func TestHubReplyToAnotherPersonsContactIsUnknownIntegration(t *testing.T) {
	f := newFixture(t)
	owner, intruder := newID(t), newID(t)
	contactID := f.contact(t, owner, 0, true)
	for _, response := range []commands.Response{
		f.reply(t, contactID, intruder, "Let me in"),
		f.delete(t, contactID, intruder),
	} {
		if response.Status != 404 ||
			problemType(t, response) != "hub-conversation-not-found" {
			t.Fatalf("response = %d %s", response.Status, response.Body)
		}
	}
	if got := f.scalar(t, `SELECT count(*)::text
        FROM vetchium.org_conversation_messages AS m
        JOIN vetchium.org_conversations AS c USING (conversation_id)
        WHERE c.contact_id = $1`, contactID); got != "1" {
		t.Fatalf("messages = %s", got)
	}
}

func TestHubReplyRefusedWhileReadOnlyIntegration(t *testing.T) {
	f := newFixture(t)
	off, gone := newID(t), newID(t)
	offContact := f.contact(t, off, 0, true)
	f.exec(t, `UPDATE vetchium.org_contacts SET messages_off = true
        WHERE contact_id = $1`, offContact)
	goneContact := f.contact(t, gone, 0, true)
	f.exec(t, `UPDATE vetchium.org_conversations
        SET read_only_reason = 'hub_user_deleted', party_deleted_at = now()
        WHERE contact_id = $1`, goneContact)
	for _, test := range []struct {
		contact, hub pgtype.UUID
		status       int
		problem      string
	}{
		{offContact, off, 403, "hub-agency-messages-off"},
		{goneContact, gone, 409, "hub-conversation-party-deleted"},
	} {
		response := f.reply(t, test.contact, test.hub, "Hello")
		if response.Status != test.status ||
			problemType(t, response) != test.problem {
			t.Fatalf("response = %d %s", response.Status, response.Body)
		}
	}
}

func TestHubDeleteKeepsAContactWithNotesIntegration(t *testing.T) {
	f := newFixture(t)
	kept, dropped := newID(t), newID(t)
	keptContact := f.contact(t, kept, 2, true)
	droppedContact := f.contact(t, dropped, 0, true)

	if response := f.delete(t, keptContact, kept); response.Status != 200 {
		t.Fatalf("delete = %d %s", response.Status, response.Body)
	}
	if got := f.scalar(t, `SELECT (SELECT count(*) FROM vetchium.org_conversations
            WHERE contact_id = $1)::text || ':' ||
        (SELECT count(*) FROM vetchium.org_contact_notes
            WHERE contact_id = $1)::text`, keptContact); got != "0:2" {
		t.Fatalf("kept = %s", got)
	}
	if _, payload := f.pointer(t, keptContact); !payload.Present ||
		payload.HasConversation || len(payload.Suggestions) != 0 {
		t.Fatalf("kept pointer = %+v", payload)
	}

	if response := f.delete(t, droppedContact, dropped); response.Status != 200 {
		t.Fatalf("delete = %d %s", response.Status, response.Body)
	}
	if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.org_contacts
        WHERE contact_id = $1`, droppedContact); got != "0" {
		t.Fatalf("dropped contacts = %s", got)
	}
	if version, payload := f.pointer(t, droppedContact); payload.Present ||
		version != 2 {
		t.Fatalf("dropped pointer = %d %+v", version, payload)
	}
	again := f.delete(t, droppedContact, dropped)
	if again.Status != 404 ||
		problemType(t, again) != "hub-conversation-not-found" {
		t.Fatalf("delete again = %d %s", again.Status, again.Body)
	}
}
