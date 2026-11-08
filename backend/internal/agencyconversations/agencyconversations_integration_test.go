package agencyconversations

import (
	"context"
	"encoding/json"
	"errors"
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
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/db/sqlc"
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
			// Notes reference the Org's users; requests and opening blocks
			// go with their Contacts.
			`DELETE FROM vetchium.org_contacts WHERE org_did = $1`,
			`DELETE FROM vetchium.federation_outbox
             WHERE convert_from(payload_bytes, 'UTF8')::jsonb
                 ->> 'agency_org_did' = $1::text`,
			`DELETE FROM vetchium.audit_events WHERE subject_org_did = $1`,
			`DELETE FROM vetchium.orgs WHERE org_did = $1`,
		} {
			if _, err := owner.Exec(ctx, sql, f.orgDID); err != nil {
				t.Errorf("clean up: %v", err)
			}
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

func handleOf(did pgtype.UUID) string {
	digits := strings.ReplaceAll(dbvalue.FormatUUID(did), "-", "")
	return digits[13:21] + "-" + digits[21:]
}

// contact seeds a Contact of the agency for hubDID, with notes notes and,
// when conversation is set, a conversation holding one agency suggestion
// (message 1) that both sides wrote in a minute ago, with a one-day window.
func (f *fixture) contact(t *testing.T, hubDID pgtype.UUID, notes int, conversation bool) {
	t.Helper()
	f.exec(t, `INSERT INTO vetchium.org_contacts (org_did, hub_user_did,
        display_name, handle, created_by, last_note_number)
        VALUES ($1, $2, 'Ada Lovelace', $3, $4, $5)`,
		f.orgDID, hubDID, handleOf(hubDID), f.userID, notes)
	for number := range notes {
		f.exec(t, `INSERT INTO vetchium.org_contact_notes (org_did,
            hub_user_did, note_number, author_id, note_text)
            VALUES ($1, $2, $3, $4, 'Strong systems background')`,
			f.orgDID, hubDID, number+1, f.userID)
	}
	if conversation {
		f.exec(t, `INSERT INTO vetchium.org_conversations (org_did,
            hub_user_did, recorded_hub_user_name, recorded_hub_user_handle,
            recorded_agency_name, recorded_agency_domain, hub_activity_at,
            agency_activity_at, window_seconds, last_message_number)
            VALUES ($1, $2, 'Ada Lovelace', $3, 'Talent Scouts',
                'scouts.example', now() - interval '1 minute',
                now() - interval '1 minute', 86400, 1)`,
			f.orgDID, hubDID, handleOf(hubDID))
		f.exec(t, `INSERT INTO vetchium.org_conversation_messages (org_did,
            hub_user_did, message_number, sender_type, sender_user_id,
            sender_display_name, kind, consumer_domain, opening_number)
            VALUES ($1, $2, 1, 'agency', $3, 'scout@conversation.example',
                'suggestion', 'client.example', 7)`,
			f.orgDID, hubDID, f.userID)
	}
}

func (f *fixture) aggregate(hubDID pgtype.UUID) string {
	return federationspec.ContactAggregateID(f.agencyDID(), hubUser(hubDID))
}

func (f *fixture) agencyDID() orgs.OrgDID { return orgs.OrgDID(dbvalue.FormatUUID(f.orgDID)) }

func hubUser(did pgtype.UUID) hub.HubUserDID { return hub.HubUserDID(dbvalue.FormatUUID(did)) }

func (f *fixture) send(
	t *testing.T, kind federationspec.CommandKind, aggregate string, payload any,
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
		AggregateID: aggregate, Payload: body,
	})
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func (f *fixture) reply(t *testing.T, hubDID pgtype.UUID, text string) commands.Response {
	t.Helper()
	return f.send(t, federationspec.HubConversationReplyKind, f.aggregate(hubDID),
		federationspec.HubConversationReplyPayload{
			AgencyOrgDID:       f.agencyDID(),
			HubUserDID:         hubUser(hubDID),
			HubUserDisplayName: "Ada King",
			HubUserHandle:      hub.HubHandle(handleOf(hubDID)),
			Text:               contacts.MessageText(text),
			WindowSeconds:      ninetyDays,
		})
}

func (f *fixture) deleteMessage(t *testing.T, hubDID pgtype.UUID, number int32) commands.Response {
	t.Helper()
	return f.send(t, federationspec.HubConversationMessageDeleteKind, f.aggregate(hubDID),
		federationspec.HubConversationMessageDeletePayload{
			AgencyOrgDID:  f.agencyDID(),
			HubUserDID:    hubUser(hubDID),
			MessageNumber: contacts.MessageNumber(number),
		})
}

// pointer is the latest agency-pointer-changed event for the pair, and the
// Contact's current pointer version.
func (f *fixture) pointer(
	t *testing.T, hubDID pgtype.UUID,
) (int64, int64, federationspec.AgencyPointerChangedPayload) {
	t.Helper()
	var version int64
	var body []byte
	if err := f.owner.QueryRow(context.Background(), `SELECT
            aggregate_version, payload_bytes FROM vetchium.federation_outbox
        WHERE kind = 'agency-pointer-changed' AND aggregate_id = $1
        ORDER BY aggregate_version DESC LIMIT 1`,
		f.aggregate(hubDID)).Scan(&version, &body); err != nil {
		t.Fatal(err)
	}
	var payload federationspec.AgencyPointerChangedPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	var current int64
	if err := f.owner.QueryRow(context.Background(), `SELECT COALESCE((
            SELECT pointer_version FROM vetchium.org_contacts
            WHERE org_did = $1 AND hub_user_did = $2), 0)`,
		f.orgDID, hubDID).Scan(&current); err != nil {
		t.Fatal(err)
	}
	return version, current, payload
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
	f.contact(t, hubDID, 0, true)
	response := f.reply(t, hubDID, "Happy to talk")
	if response.Status != 200 {
		t.Fatalf("reply = %d %s", response.Status, response.Body)
	}
	var posted contacts.ConversationMessage
	if err := json.Unmarshal(response.Body, &posted); err != nil ||
		posted.MessageNumber != 2 || posted.Deleted {
		t.Fatalf("reply body = %s, %v", response.Body, err)
	}
	if got := f.scalar(t, `SELECT c.agency_unread_count::text || ':' ||
            c.recorded_hub_user_name || ':' || c.window_seconds::text || ':' ||
            (c.hub_activity_at = m.sent_at)::text || ':' || c.last_message_number
        FROM vetchium.org_conversations AS c
        JOIN vetchium.org_conversation_messages AS m USING (org_did, hub_user_did)
        WHERE c.org_did = $1 AND c.hub_user_did = $2 AND m.kind = 'text'`,
		f.orgDID, hubDID); got != "1:Ada King:7776000:true:2" {
		t.Fatalf("conversation = %s", got)
	}
	if got := f.scalar(t, `SELECT display_name FROM vetchium.org_contacts
        WHERE org_did = $1 AND hub_user_did = $2`, f.orgDID, hubDID); got != "Ada King" {
		t.Fatalf("contact = %s", got)
	}
	version, current, payload := f.pointer(t, hubDID)
	if version != current || !payload.Present || !payload.HasConversation ||
		payload.NewAgencyMessage || len(payload.Suggestions) != 1 ||
		payload.Suggestions[0].ConsumerDomain != "client.example" ||
		payload.Suggestions[0].OpeningNumber != 7 ||
		payload.Suggestions[0].SentAt.IsZero() {
		t.Fatalf("pointer = %d/%d %+v", version, current, payload)
	}
	second := f.reply(t, hubDID, "Mornings suit me")
	if second.Status != 200 {
		t.Fatalf("second reply = %d %s", second.Status, second.Body)
	}
	if next, _, _ := f.pointer(t, hubDID); next != version+1 {
		t.Fatalf("pointer version = %d, want %d", next, version+1)
	}
	if got := f.scalar(t, `SELECT agency_unread_count::text
        FROM vetchium.org_conversations WHERE org_did = $1 AND hub_user_did = $2`,
		f.orgDID, hubDID); got != "2" {
		t.Fatalf("unread = %s", got)
	}
}

func TestHubCommandsWithoutAContactAreUnknownIntegration(t *testing.T) {
	f := newFixture(t)
	owner, stranger := newID(t), newID(t)
	f.contact(t, owner, 0, true)
	for _, test := range []struct {
		response commands.Response
		problem  string
	}{
		{f.reply(t, stranger, "Let me in"), "hub-conversation-not-found"},
		{f.deleteMessage(t, stranger, 1), "hub-conversation-message-not-found"},
	} {
		if test.response.Status != 404 || problemType(t, test.response) != test.problem {
			t.Fatalf("response = %d %s", test.response.Status, test.response.Body)
		}
	}
	if got := f.scalar(t, `SELECT count(*)::text
        FROM vetchium.org_conversation_messages
        WHERE org_did = $1 AND hub_user_did = $2`, f.orgDID, owner); got != "1" {
		t.Fatalf("messages = %s", got)
	}
}

// A command that names another agency than its authority is malformed.
func TestHubCommandForAnotherAgencyIsRejectedIntegration(t *testing.T) {
	f := newFixture(t)
	hubDID := newID(t)
	f.contact(t, hubDID, 0, true)
	other := orgs.OrgDID(dbvalue.FormatUUID(newID(t)))
	response := f.send(t, federationspec.HubConversationReplyKind,
		federationspec.ContactAggregateID(other, hubUser(hubDID)),
		federationspec.HubConversationReplyPayload{
			AgencyOrgDID:       other,
			HubUserDID:         hubUser(hubDID),
			HubUserDisplayName: "Ada King",
			HubUserHandle:      hub.HubHandle(handleOf(hubDID)),
			Text:               "Hello", WindowSeconds: ninetyDays,
		})
	if got := problemType(t, response); got != "validation-failed" {
		t.Fatalf("response = %d %s", response.Status, response.Body)
	}
}

// Turning agency requests off never makes a conversation read-only
// (MKT-CNV-006); only a deleted party does (MKT-CNV-011).
func TestHubReplyRefusedOnlyWhileReadOnlyIntegration(t *testing.T) {
	f := newFixture(t)
	off, gone := newID(t), newID(t)
	f.contact(t, off, 0, true)
	f.exec(t, `UPDATE vetchium.org_contacts SET requests_off = true
        WHERE org_did = $1 AND hub_user_did = $2`, f.orgDID, off)
	f.contact(t, gone, 0, true)
	f.exec(t, `UPDATE vetchium.org_conversations
        SET read_only_reason = 'hub_user_deleted', party_deleted_at = now()
        WHERE org_did = $1 AND hub_user_did = $2`, f.orgDID, gone)
	for _, test := range []struct {
		hub     pgtype.UUID
		status  int
		problem string
	}{
		{off, 200, ""},
		{gone, 409, "hub-conversation-party-deleted"},
	} {
		response := f.reply(t, test.hub, "Hello")
		if response.Status != test.status ||
			(test.problem != "" && problemType(t, response) != test.problem) {
			t.Fatalf("response = %d %s", response.Status, response.Body)
		}
	}
}

// The Hub user deletes only their own text messages; the agency keeps the
// stub and an audit without the text (MKT-CNV-007).
func TestHubDeletesOnlyItsOwnMessagesIntegration(t *testing.T) {
	f := newFixture(t)
	hubDID := newID(t)
	f.contact(t, hubDID, 0, true)
	if response := f.reply(t, hubDID, "Please forget my number"); response.Status != 200 {
		t.Fatalf("reply = %d %s", response.Status, response.Body)
	}
	agencys := f.deleteMessage(t, hubDID, 1)
	if agencys.Status != 404 || problemType(t, agencys) != "hub-conversation-message-not-found" {
		t.Fatalf("delete the agency's message = %d %s", agencys.Status, agencys.Body)
	}
	response := f.deleteMessage(t, hubDID, 2)
	if response.Status != 200 {
		t.Fatalf("delete = %d %s", response.Status, response.Body)
	}
	var stub contacts.ConversationMessage
	if err := json.Unmarshal(response.Body, &stub); err != nil {
		t.Fatal(err)
	}
	if !stub.Deleted || stub.Text != nil || stub.MessageNumber != 2 ||
		stub.SenderType != contacts.MessageSenderTypeHubUser {
		t.Fatalf("stub = %s", response.Body)
	}
	if got := f.scalar(t, `SELECT (message_text IS NULL)::text || ':' ||
            (deleted_at IS NOT NULL)::text
        FROM vetchium.org_conversation_messages
        WHERE org_did = $1 AND hub_user_did = $2 AND message_number = 2`,
		f.orgDID, hubDID); got != "true:true" {
		t.Fatalf("message = %s", got)
	}
	if got := f.scalar(t, `SELECT string_agg(actor_type || ':' ||
            (payload ->> 'message_number') || ':' || (payload ? 'deleted_text')::text, ',')
        FROM vetchium.audit_events
        WHERE subject_org_did = $1 AND subject_hub_user_did = $2
          AND action = 'org.conversation.message_deleted'`,
		f.orgDID, hubDID); got != "hub_user:2:false" {
		t.Fatalf("audit = %s", got)
	}
	if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.audit_events
        WHERE subject_org_did = $1 AND payload::text LIKE '%forget my number%'`,
		f.orgDID); got != "0" {
		t.Fatalf("audit events carrying the text = %s", got)
	}
	read, err := ReadForHubUser(context.Background(), sqlc.New(f.owner),
		federationspec.MeshReadConversationRequest{
			HubUserDID: hubUser(hubDID), AgencyOrgDID: f.agencyDID(),
		})
	if err != nil || len(read.Messages) != 2 || !read.Messages[0].Deleted ||
		read.Messages[0].Text != nil || read.Messages[1].Deleted {
		t.Fatalf("read = %+v, %v", read, err)
	}
	again := f.deleteMessage(t, hubDID, 2)
	if again.Status != 404 || problemType(t, again) != "hub-conversation-message-not-found" {
		t.Fatalf("delete again = %d %s", again.Status, again.Body)
	}
}

// request seeds the agency's pending request to hubDID, sent an hour ago,
// under the Contact's next request number.
func (f *fixture) request(t *testing.T, hubDID pgtype.UUID) int32 {
	t.Helper()
	var number int32
	if err := f.owner.QueryRow(context.Background(), `WITH bumped AS (
            UPDATE vetchium.org_contacts
            SET last_request_number = last_request_number + 1
            WHERE org_did = $1 AND hub_user_did = $2
            RETURNING org_did, hub_user_did, last_request_number
        )
        INSERT INTO vetchium.org_chat_requests (org_did, hub_user_did,
            request_number, direction, state, consumer_domain,
            opening_number, note, sender_user_id, sender_display_name, sent_at)
        SELECT org_did, hub_user_did, last_request_number, 'to_hub_user',
            'pending', 'client.example', 9, 'A role you would enjoy', $3,
            'scout@conversation.example', now() - interval '1 hour'
        FROM bumped
        RETURNING request_number`, f.orgDID, hubDID, f.userID).Scan(&number); err != nil {
		t.Fatal(err)
	}
	return number
}

const ninetyDays = 90 * 24 * 60 * 60

func (f *fixture) answer(
	t *testing.T, number int32, hubDID pgtype.UUID,
	scope *contacts.ChatRequestDeclineScope,
) commands.Response {
	t.Helper()
	return f.send(t, federationspec.HubChatRequestAnswerKind, f.aggregate(hubDID),
		federationspec.HubChatRequestAnswerPayload{
			AgencyOrgDID:       f.agencyDID(),
			RequestNumber:      contacts.ChatRequestNumber(number),
			HubUserDID:         hubUser(hubDID),
			HubUserDisplayName: "Ada King",
			HubUserHandle:      hub.HubHandle(handleOf(hubDID)),
			Accept:             scope == nil,
			Scope:              scope,
			WindowSeconds:      ninetyDays,
		})
}

// requestOf joins a request to its pair's conversation.
const requestOf = `FROM vetchium.org_chat_requests AS r
        JOIN vetchium.org_conversations AS c USING (org_did, hub_user_did)
        WHERE r.org_did = $1 AND r.hub_user_did = $2 AND r.request_number = $3`

func TestHubAcceptOpensTheConversationWithTheRequestIntegration(t *testing.T) {
	f := newFixture(t)
	hubDID := newID(t)
	f.contact(t, hubDID, 0, false)
	number := f.request(t, hubDID)

	response := f.answer(t, number, hubDID, nil)
	if response.Status != 200 {
		t.Fatalf("accept = %d %s", response.Status, response.Body)
	}
	var answered federationspec.AgencyPointerRequest
	if err := json.Unmarshal(response.Body, &answered); err != nil {
		t.Fatal(err)
	}
	if answered.State != contacts.ChatRequestAccepted || answered.AnsweredAt == nil ||
		answered.DeclineScope != nil || answered.RequestNumber != contacts.ChatRequestNumber(number) ||
		len(answered.Validate()) != 0 {
		t.Fatalf("answered = %s", response.Body)
	}
	if got := f.scalar(t, `SELECT r.state || ':' || (r.note IS NULL)::text || ':' ||
            r.window_seconds::text || ':' ||
            (c.agency_activity_at = r.sent_at)::text || ':' ||
            (c.hub_activity_at = r.answered_at)::text || ':' ||
            c.window_seconds::text || ':' || c.recorded_hub_user_name || ':' ||
            c.agency_unread_count::text `+requestOf, f.orgDID, hubDID, number); got !=
		"accepted:true:7776000:true:true:7776000:Ada King:0" {
		t.Fatalf("request and conversation = %s", got)
	}
	if got := f.scalar(t, `SELECT string_agg(m.message_number || ':' || m.kind || ':' ||
            m.sender_type || ':' || m.message_text || ':' || m.consumer_domain || ':' ||
            m.opening_number::text || ':' || (m.sent_at = r.sent_at)::text, ',')
        FROM vetchium.org_conversation_messages AS m
        JOIN vetchium.org_chat_requests AS r USING (org_did, hub_user_did)
        WHERE r.org_did = $1 AND r.hub_user_did = $2 AND r.request_number = $3`,
		f.orgDID, hubDID, number); got !=
		"1:request:agency:A role you would enjoy:client.example:9:true" {
		t.Fatalf("messages = %s", got)
	}
	if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.audit_events
        WHERE subject_org_did = $1 AND payload::text LIKE '%enjoy%'`,
		f.orgDID); got != "0" {
		t.Fatalf("audit events carrying the note = %s", got)
	}
	_, _, pointer := f.pointer(t, hubDID)
	if !pointer.HasConversation || pointer.NewAgencyMessage ||
		pointer.Request == nil || pointer.Request.State != contacts.ChatRequestAccepted ||
		len(pointer.Suggestions) != 1 || pointer.Suggestions[0].OpeningNumber != 9 ||
		pointer.AgencyMayWriteUntil == nil || pointer.HubMayWriteUntil == nil {
		t.Fatalf("pointer = %+v", pointer)
	}

	again := f.answer(t, number, hubDID, nil)
	if again.Status != 404 || problemType(t, again) != "hub-chat-request-not-found" {
		t.Fatalf("accept again = %d %s", again.Status, again.Body)
	}
}

func TestHubAcceptAppendsToAnEarlierConversationIntegration(t *testing.T) {
	f := newFixture(t)
	hubDID := newID(t)
	f.contact(t, hubDID, 0, true)
	number := f.request(t, hubDID)
	if response := f.answer(t, number, hubDID, nil); response.Status != 200 {
		t.Fatalf("accept = %d %s", response.Status, response.Body)
	}
	if got := f.scalar(t, `SELECT string_agg(message_number || kind, ',' ORDER BY message_number)
        FROM vetchium.org_conversation_messages
        WHERE org_did = $1 AND hub_user_did = $2`, f.orgDID, hubDID); got != "1suggestion,2request" {
		t.Fatalf("messages = %s", got)
	}
	if _, _, pointer := f.pointer(t, hubDID); len(pointer.Suggestions) != 2 {
		t.Fatalf("suggestions = %+v", pointer.Suggestions)
	}
}

func TestHubAcceptRefusedWhileTheConversationIsReadOnlyIntegration(t *testing.T) {
	f := newFixture(t)
	hubDID := newID(t)
	f.contact(t, hubDID, 0, true)
	f.exec(t, `UPDATE vetchium.org_conversations
        SET read_only_reason = 'agency_deleted', party_deleted_at = now()
        WHERE org_did = $1 AND hub_user_did = $2`, f.orgDID, hubDID)
	number := f.request(t, hubDID)
	response := f.answer(t, number, hubDID, nil)
	if response.Status != 409 ||
		problemType(t, response) != "hub-conversation-party-deleted" {
		t.Fatalf("accept = %d %s", response.Status, response.Body)
	}
	if got := f.scalar(t, `SELECT r.state || ':' || (r.note IS NOT NULL)::text || ':' ||
            (SELECT count(*) FROM vetchium.org_conversation_messages AS m
                WHERE m.org_did = r.org_did AND m.hub_user_did = r.hub_user_did)::text
        `+requestOf, f.orgDID, hubDID, number); got != "pending:true:1" {
		t.Fatalf("request = %s", got)
	}
}

func TestHubDeclineBlocksByScopeIntegration(t *testing.T) {
	f := newFixture(t)
	for _, scope := range []contacts.ChatRequestDeclineScope{
		contacts.DeclineOpening, contacts.DeclineSender,
	} {
		hubDID := newID(t)
		f.contact(t, hubDID, 0, false)
		number := f.request(t, hubDID)
		response := f.answer(t, number, hubDID, &scope)
		if response.Status != 200 {
			t.Fatalf("%s: decline = %d %s", scope, response.Status, response.Body)
		}
		var answered federationspec.AgencyPointerRequest
		if err := json.Unmarshal(response.Body, &answered); err != nil {
			t.Fatal(err)
		}
		if answered.State != contacts.ChatRequestDeclined || answered.DeclineScope == nil ||
			*answered.DeclineScope != scope || len(answered.Validate()) != 0 {
			t.Fatalf("%s: answered = %s", scope, response.Body)
		}
		want := "declined:true:0:to_hub_user client.example 9:"
		if scope == contacts.DeclineSender {
			want = "declined:true:0::true"
		}
		if got := f.scalar(t, `SELECT r.state || ':' || (r.note IS NULL)::text || ':' ||
                (SELECT count(*) FROM vetchium.org_conversations AS c
                    WHERE c.org_did = r.org_did AND c.hub_user_did = r.hub_user_did)::text
                || ':' || COALESCE((SELECT string_agg(concat_ws(' ',
                    b.blocked_direction, b.consumer_domain, b.opening_number), ',')
                FROM vetchium.org_chat_request_opening_blocks AS b
                WHERE b.org_did = r.org_did AND b.hub_user_did = r.hub_user_did), '')
                || ':' || COALESCE((t.agency_requests_blocked_until = r.answered_at +
                    make_interval(secs => r.window_seconds))::text, '')
            FROM vetchium.org_chat_requests AS r
            JOIN vetchium.org_contacts AS t USING (org_did, hub_user_did)
            WHERE r.org_did = $1 AND r.hub_user_did = $2 AND r.request_number = $3`,
			f.orgDID, hubDID, number); got != want {
			t.Fatalf("%s: request and block = %s", scope, got)
		}
		_, _, pointer := f.pointer(t, hubDID)
		if pointer.HasConversation || pointer.Request == nil ||
			pointer.Request.State != contacts.ChatRequestDeclined ||
			(scope == contacts.DeclineSender) != (pointer.Request.BlockedUntil != nil) ||
			(answered.BlockedUntil != nil && !answered.BlockedUntil.Equal(*pointer.Request.BlockedUntil)) {
			t.Fatalf("%s: pointer = %+v", scope, pointer)
		}
	}
}

func TestHubAnswerToAnotherPersonsRequestIsUnknownIntegration(t *testing.T) {
	f := newFixture(t)
	owner, stranger := newID(t), newID(t)
	f.contact(t, owner, 0, false)
	number := f.request(t, owner)
	scope := contacts.DeclineSender
	for _, response := range []commands.Response{
		f.answer(t, number, stranger, nil),
		f.answer(t, number, stranger, &scope),
		f.answer(t, number+1, owner, nil),
	} {
		if response.Status != 404 ||
			problemType(t, response) != "hub-chat-request-not-found" {
			t.Fatalf("response = %d %s", response.Status, response.Body)
		}
	}
	if got := f.scalar(t, `SELECT state FROM vetchium.org_chat_requests
        WHERE org_did = $1 AND hub_user_did = $2 AND request_number = $3`,
		f.orgDID, owner, number); got != "pending" {
		t.Fatalf("state = %s", got)
	}
}

func TestHubReplyRefusedOnceTheWindowLapsedIntegration(t *testing.T) {
	f := newFixture(t)
	hubDID := newID(t)
	f.contact(t, hubDID, 0, true)
	// The agency wrote 91 days ago; the reply's 90-day window has passed.
	f.exec(t, `UPDATE vetchium.org_conversations
        SET agency_activity_at = now() - interval '91 days'
        WHERE org_did = $1 AND hub_user_did = $2`, f.orgDID, hubDID)
	response := f.reply(t, hubDID, "Still there?")
	if response.Status != 409 || problemType(t, response) != "hub-conversation-closed" {
		t.Fatalf("reply = %d %s", response.Status, response.Body)
	}
	if got := f.scalar(t, `SELECT window_seconds::text FROM vetchium.org_conversations
        WHERE org_did = $1 AND hub_user_did = $2`, f.orgDID, hubDID); got != "86400" {
		t.Fatalf("window after a refusal = %s", got)
	}
}

func TestHubReplyAcceptsThePendingAgencyRequestFirstIntegration(t *testing.T) {
	f := newFixture(t)
	hubDID := newID(t)
	f.contact(t, hubDID, 0, true)
	f.exec(t, `UPDATE vetchium.org_conversations
        SET agency_activity_at = now() - interval '91 days'
        WHERE org_did = $1 AND hub_user_did = $2`, f.orgDID, hubDID)
	number := f.request(t, hubDID)
	if response := f.reply(t, hubDID, "Yes, tell me more"); response.Status != 200 {
		t.Fatalf("reply = %d %s", response.Status, response.Body)
	}
	if got := f.scalar(t, `SELECT state FROM vetchium.org_chat_requests
        WHERE org_did = $1 AND hub_user_did = $2 AND request_number = $3`,
		f.orgDID, hubDID, number); got != "accepted" {
		t.Fatalf("request = %s", got)
	}
	if got := f.scalar(t, `SELECT string_agg(kind, ',' ORDER BY message_number)
        FROM vetchium.org_conversation_messages
        WHERE org_did = $1 AND hub_user_did = $2`, f.orgDID, hubDID); got != "suggestion,request,text" {
		t.Fatalf("messages = %s", got)
	}
	_, _, pointer := f.pointer(t, hubDID)
	if pointer.Request == nil || pointer.Request.State != contacts.ChatRequestAccepted ||
		pointer.AgencyMayWriteUntil == nil || pointer.HubMayWriteUntil == nil {
		t.Fatalf("pointer = %+v", pointer)
	}
}

func TestReadForHubUserCarriesTheWindowAndThePendingNoteIntegration(t *testing.T) {
	f := newFixture(t)
	talking, asked, stranger := newID(t), newID(t), newID(t)
	f.contact(t, talking, 0, true)
	f.contact(t, asked, 0, false)
	f.request(t, asked)
	read := func(
		hubDID pgtype.UUID, number *contacts.MessageNumber,
	) (federationspec.MeshReadConversationResponse, error) {
		t.Helper()
		return ReadForHubUser(context.Background(), sqlc.New(f.owner),
			federationspec.MeshReadConversationRequest{
				HubUserDID: hubUser(hubDID), AgencyOrgDID: f.agencyDID(),
				MessageNumber: number,
			})
	}

	open, err := read(talking, nil)
	if err != nil || open.AgencyMayWriteUntil == nil || open.HubMayWriteUntil == nil ||
		open.PendingRequestNote != nil || len(open.Messages) != 1 ||
		open.Messages[0].SenderDisplayName != "Talent Scouts" {
		t.Fatalf("conversation read = %+v, %v", open, err)
	}
	first := contacts.MessageNumber(1)
	one, err := read(talking, &first)
	if err != nil || len(one.Messages) != 1 || one.Messages[0].MessageNumber != 1 ||
		one.Messages[0].Suggestion == nil {
		t.Fatalf("one message read = %+v, %v", one, err)
	}
	missing := contacts.MessageNumber(2)
	if _, err := read(talking, &missing); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("missing message read error = %v", err)
	}
	pending, err := read(asked, nil)
	if err != nil || pending.PendingRequestNote == nil ||
		*pending.PendingRequestNote != "A role you would enjoy" ||
		pending.Messages == nil || len(pending.Messages) != 0 ||
		pending.AgencyMayWriteUntil != nil {
		t.Fatalf("request-only read = %+v, %v", pending, err)
	}
	if _, err := read(stranger, nil); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a stranger's read error = %v", err)
	}
}
