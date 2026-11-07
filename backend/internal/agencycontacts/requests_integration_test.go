package agencycontacts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

func TestRefuseAppliesTheRefusalsInOrderIntegration(t *testing.T) {
	f := newFixture(t)
	agency := f.agency(t)
	contactID := f.contact(t, agency, newID(t), true)
	opening := contacts.OpeningSuggestion{ConsumerDomain: "client.example", OpeningNumber: 3}
	other := contacts.OpeningSuggestion{ConsumerDomain: "client.example", OpeningNumber: 4}
	refuse := func(direction contacts.ChatRequestDirection, about contacts.OpeningSuggestion) Refusal {
		t.Helper()
		refusal, err := Refuse(context.Background(), sqlc.New(f.owner), agency,
			contactID, direction, about, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		return refusal
	}
	expect := func(step string, direction contacts.ChatRequestDirection,
		about contacts.OpeningSuggestion, want Refusal) {
		t.Helper()
		if got := refuse(direction, about); got != want {
			t.Fatalf("%s: %v refusal = %d, want %d", step, direction, got, want)
		}
	}

	expect("nothing", contacts.ToHubUser, opening, NotRefused)
	expect("nothing", contacts.ToAgency, opening, NotRefused)

	f.exec(t, `INSERT INTO vetchium.org_chat_request_blocks (contact_id,
            blocked_direction, scope, consumer_domain, opening_number)
        VALUES ($1, 'to_hub_user', 'opening', 'client.example', 3)`, contactID)
	expect("opening block", contacts.ToHubUser, opening, RefusedBlocked)
	expect("opening block, other Opening", contacts.ToHubUser, other, NotRefused)
	expect("opening block binds one direction", contacts.ToAgency, opening, NotRefused)

	f.exec(t, `INSERT INTO vetchium.org_chat_request_blocks (contact_id,
            blocked_direction, scope, blocked_until, created_at)
        VALUES ($1, 'to_agency', 'sender', now() - interval '1 day',
            now() - interval '2 days')`, contactID)
	expect("lifted sender block", contacts.ToAgency, opening, NotRefused)
	f.exec(t, `INSERT INTO vetchium.org_chat_request_blocks (contact_id,
            blocked_direction, scope, blocked_until)
        VALUES ($1, 'to_agency', 'sender', now() + interval '1 day')`, contactID)
	expect("sender block", contacts.ToAgency, other, RefusedBlocked)

	// The Hub user wrote just now, so the agency may write; the agency's
	// last activity is older than the window, so the Hub user may not.
	f.exec(t, `UPDATE vetchium.org_conversations
        SET hub_activity_at = now(),
            agency_activity_at = now() - interval '2 days',
            window_seconds = 86400
        WHERE contact_id = $1`, contactID)
	expect("conversation open", contacts.ToHubUser, opening, RefusedConversationOpen)
	expect("closed to the Hub user", contacts.ToAgency, opening, RefusedBlocked)

	f.exec(t, `INSERT INTO vetchium.org_chat_requests (request_id, contact_id,
            org_did, hub_user_did, direction, state, consumer_domain,
            opening_number, sender_display_name)
        SELECT $2, contact_id, org_did, hub_user_did, 'to_agency', 'pending',
            'client.example', 4, 'Ada Lovelace'
        FROM vetchium.org_contacts WHERE contact_id = $1`, contactID, newID(t))
	expect("pending", contacts.ToHubUser, opening, RefusedRequestPending)
	expect("pending", contacts.ToAgency, opening, RefusedRequestPending)

	f.exec(t, `UPDATE vetchium.org_conversations
        SET read_only_reason = 'hub_user_deleted', party_deleted_at = now()
        WHERE contact_id = $1`, contactID)
	expect("party deleted", contacts.ToHubUser, opening, RefusedPartyDeleted)
}

func TestCreateOrgChatRequestCountsOnlyAgencySendsIntegration(t *testing.T) {
	f := newFixture(t)
	agency := f.agency(t)
	first := f.contact(t, agency, newID(t), false)
	second := f.contact(t, agency, newID(t), false)
	ctx := context.Background()
	day := pgtype.Date{Time: time.Now().UTC().Truncate(24 * time.Hour), Valid: true}
	hubUserOf := func(contactID pgtype.UUID) pgtype.UUID {
		t.Helper()
		var did pgtype.UUID
		if err := f.owner.QueryRow(ctx, `SELECT hub_user_did
            FROM vetchium.org_contacts WHERE contact_id = $1`, contactID).
			Scan(&did); err != nil {
			t.Fatal(err)
		}
		return did
	}
	create := func(contactID pgtype.UUID, direction contacts.ChatRequestDirection) (sqlc.CreateOrgChatRequestRow, error) {
		t.Helper()
		tx, err := f.app.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		params := sqlc.CreateOrgChatRequestParams{
			RequestID: newID(t), ContactID: contactID, OrgDid: agency,
			HubUserDid: hubUserOf(contactID), Direction: string(direction),
			ConsumerDomain: "client.example", OpeningNumber: 3,
			Note:              dbvalue.Text("A role you would enjoy"),
			SenderDisplayName: "Ada Lovelace", Day: day, TenantID: "usa1",
			ActorType: "hub_user", ActorID: "hub", Source: "test",
		}
		if direction == contacts.ToHubUser {
			params.SenderUserID = f.userID
			params.SenderDisplayName = "scout@contacts.example"
			params.ActorType, params.ActorID = "org_user", dbvalue.FormatUUID(f.userID)
		}
		row, err := sqlc.New(tx).CreateOrgChatRequest(ctx, params)
		if err != nil {
			return row, err
		}
		return row, tx.Commit(ctx)
	}

	sent, err := create(first, contacts.ToHubUser)
	if err != nil || sent.CountedRows != 1 || sent.ContactRows != 1 || sent.AuditRows != 1 {
		t.Fatalf("agency request = %+v, %v", sent, err)
	}
	var pgErr *pgconn.PgError
	if _, err := create(first, contacts.ToAgency); !errors.As(err, &pgErr) ||
		pgErr.ConstraintName != "org_chat_requests_pending_key" {
		t.Fatalf("second pending request error = %v", err)
	}
	received, err := create(second, contacts.ToAgency)
	if err != nil || received.CountedRows != 0 || received.AuditRows != 1 {
		t.Fatalf("Hub user request = %+v, %v", received, err)
	}
	count, err := sqlc.New(f.owner).CountOrgChatRequestsCreatedOn(ctx,
		sqlc.CountOrgChatRequestsCreatedOnParams{OrgDid: agency, Day: day})
	if err != nil || count != 1 {
		t.Fatalf("day's count = %d, %v", count, err)
	}
	if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.audit_events
        WHERE subject_org_did = $1 AND action = 'org.chat_request.sent'
          AND payload::text LIKE '%enjoy%'`, agency); got != "0" {
		t.Fatalf("audit events carrying the note = %s", got)
	}
}

func TestSyncPointerCarriesTheRequestWithoutItsNoteIntegration(t *testing.T) {
	f := newFixture(t)
	agency := f.agency(t)
	contactID := f.contact(t, agency, newID(t), false)
	requestID := newID(t)
	f.exec(t, `INSERT INTO vetchium.org_chat_requests (request_id, contact_id,
            org_did, hub_user_did, direction, state, consumer_domain,
            opening_number, note, sender_user_id, sender_display_name)
        SELECT $2, contact_id, org_did, hub_user_did, 'to_hub_user',
            'pending', 'client.example', 3, 'A role you would enjoy', $3,
            'scout@contacts.example'
        FROM vetchium.org_contacts WHERE contact_id = $1`,
		contactID, requestID, f.userID)

	ctx := context.Background()
	tx, err := f.owner.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := SyncPointer(ctx, sqlc.New(tx), agency, contactID, NoticeRequest); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var body []byte
	if err := f.owner.QueryRow(ctx, `SELECT payload_bytes
        FROM vetchium.federation_outbox
        WHERE kind = 'agency-pointer-changed' AND aggregate_id = $1`,
		dbvalue.FormatUUID(contactID)).Scan(&body); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(body, []byte("enjoy")) {
		t.Fatalf("pointer event carries the note: %s", body)
	}
	var payload federationspec.AgencyPointerChangedPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Validate()) != 0 || payload.HasConversation ||
		!payload.NewAgencyRequest || payload.NewAgencyMessage ||
		payload.AgencyDisplayName != "Talent Scouts" || payload.AgencyDomain == "" ||
		payload.LastActivityAt == nil || payload.Request == nil ||
		payload.Request.RequestID != contacts.ChatRequestID(dbvalue.FormatUUID(requestID)) ||
		payload.Request.State != contacts.ChatRequestPending ||
		payload.Request.Direction != contacts.ToHubUser ||
		!payload.Request.SentAt.Equal(*payload.LastActivityAt) {
		t.Fatalf("payload = %s", body)
	}
}

func TestAnswerRequestToTheAgencyMakesTheAgencyActiveIntegration(t *testing.T) {
	f := newFixture(t)
	agency := f.agency(t)
	contactID := f.contact(t, agency, newID(t), false)
	requestID := newID(t)
	f.exec(t, `INSERT INTO vetchium.org_chat_requests (request_id, contact_id,
            org_did, hub_user_did, direction, state, consumer_domain,
            opening_number, note, sender_display_name, window_seconds, sent_at)
        SELECT $2, contact_id, org_did, hub_user_did, 'to_agency', 'pending',
            'client.example', 3, 'I would like this role', 'Ada Lovelace',
            86400, now() - interval '1 hour'
        FROM vetchium.org_contacts WHERE contact_id = $1`, contactID, requestID)

	ctx := context.Background()
	tx, err := f.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	found, err := q.GetPendingOrgChatRequest(ctx, contactID)
	if err != nil {
		t.Fatal(err)
	}
	answered, err := AnswerRequest(ctx, q, found.VetchiumOrgChatRequest,
		Answer{Accept: true, HubUserName: "Ada Lovelace", HubUserHandle: "abcd1234-0123456789a"},
		Answerer{
			TenantID: "usa1", ActorType: "org_user",
			ActorID: dbvalue.FormatUUID(f.userID), Source: "test",
			OrgUserID: f.userID,
		})
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if answered.State != string(contacts.ChatRequestAccepted) || answered.Note.Valid ||
		answered.AnsweredBy != f.userID {
		t.Fatalf("answered = %+v", answered)
	}
	if got := f.scalar(t, `SELECT (c.agency_activity_at = r.answered_at)::text || ':' ||
            (c.hub_activity_at = r.sent_at)::text || ':' || c.window_seconds::text || ':' ||
            m.sender_type || ':' || m.message_text || ':' ||
            (SELECT count(*) FROM vetchium.org_conversation_messages AS s
                WHERE s.conversation_id = c.conversation_id
                  AND s.kind = 'suggestion')::text
        FROM vetchium.org_chat_requests AS r
        JOIN vetchium.org_conversations AS c USING (contact_id)
        JOIN vetchium.org_conversation_messages AS m USING (conversation_id)
        WHERE r.request_id = $1`, requestID); got !=
		"true:true:86400:hub_user:I would like this role:0" {
		t.Fatalf("conversation = %s", got)
	}
	suggestions, err := sqlc.New(f.owner).ListOrgConversationSuggestions(ctx,
		answeredConversation(t, f, contactID))
	if err != nil || len(suggestions) != 0 {
		t.Fatalf("a Hub user's request suggested %v, %v", suggestions, err)
	}
}

func answeredConversation(t *testing.T, f *fixture, contactID pgtype.UUID) pgtype.UUID {
	t.Helper()
	var id pgtype.UUID
	if err := f.owner.QueryRow(context.Background(), `SELECT conversation_id
        FROM vetchium.org_conversations WHERE contact_id = $1`, contactID).
		Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
