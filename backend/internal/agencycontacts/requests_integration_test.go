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
	c := f.contact(t, agency, newID(t), true)
	opening := contacts.OpeningSuggestion{ConsumerDomain: "client.example", OpeningNumber: 3}
	other := contacts.OpeningSuggestion{ConsumerDomain: "client.example", OpeningNumber: 4}
	refuse := func(direction contacts.ChatRequestDirection, about contacts.OpeningSuggestion) Refusal {
		t.Helper()
		refusal, err := Refuse(context.Background(), sqlc.New(f.owner), c.org,
			c.hub, direction, about, time.Now())
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

	f.exec(t, `INSERT INTO vetchium.org_chat_request_opening_blocks (org_did,
            hub_user_did, blocked_direction, consumer_domain, opening_number)
        VALUES ($1, $2, 'to_hub_user', 'client.example', 3)`, c.org, c.hub)
	expect("opening block", contacts.ToHubUser, opening, RefusedBlocked)
	expect("opening block, other Opening", contacts.ToHubUser, other, NotRefused)
	expect("opening block binds one direction", contacts.ToAgency, opening, NotRefused)

	f.exec(t, `UPDATE vetchium.org_contacts
        SET hub_requests_blocked_until = now() - interval '1 day'
        WHERE org_did = $1 AND hub_user_did = $2`, c.org, c.hub)
	expect("lifted sender block", contacts.ToAgency, opening, NotRefused)
	f.exec(t, `UPDATE vetchium.org_contacts
        SET hub_requests_blocked_until = now() + interval '1 day'
        WHERE org_did = $1 AND hub_user_did = $2`, c.org, c.hub)
	expect("sender block", contacts.ToAgency, other, RefusedBlocked)

	// The Hub user wrote just now, so the agency may write; the agency's
	// last activity is older than the window, so the Hub user may not.
	f.exec(t, `UPDATE vetchium.org_conversations
        SET hub_activity_at = now(),
            agency_activity_at = now() - interval '2 days',
            window_seconds = 86400
        WHERE org_did = $1 AND hub_user_did = $2`, c.org, c.hub)
	expect("conversation open", contacts.ToHubUser, opening, RefusedConversationOpen)
	expect("closed to the Hub user", contacts.ToAgency, opening, RefusedBlocked)

	f.request(t, c, contacts.ToAgency)
	expect("pending", contacts.ToHubUser, opening, RefusedRequestPending)
	expect("pending", contacts.ToAgency, opening, RefusedRequestPending)

	f.exec(t, `UPDATE vetchium.org_conversations
        SET read_only_reason = 'hub_user_deleted', party_deleted_at = now()
        WHERE org_did = $1 AND hub_user_did = $2`, c.org, c.hub)
	expect("party deleted", contacts.ToHubUser, opening, RefusedPartyDeleted)
}

func TestCreateOrgChatRequestCountsOnlyAgencySendsIntegration(t *testing.T) {
	f := newFixture(t)
	agency := f.agency(t)
	first := f.contact(t, agency, newID(t), false)
	second := f.contact(t, agency, newID(t), false)
	ctx := context.Background()
	day := pgtype.Date{Time: time.Now().UTC().Truncate(24 * time.Hour), Valid: true}
	create := func(c pair, direction contacts.ChatRequestDirection) (sqlc.CreateOrgChatRequestRow, error) {
		t.Helper()
		tx, err := f.app.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		params := sqlc.CreateOrgChatRequestParams{
			OrgDid: agency, HubUserDid: c.hub, Direction: string(direction),
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
	if err != nil || sent.RequestNumber != 1 || sent.CountedRows != 1 || sent.AuditRows != 1 {
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
	c := f.contact(t, agency, newID(t), false)
	number := f.request(t, c, contacts.ToHubUser)

	ctx := context.Background()
	tx, err := f.owner.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := SyncPointer(ctx, sqlc.New(tx), c.org, c.hub, NoticeRequest); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var body []byte
	if err := f.owner.QueryRow(ctx, `SELECT payload_bytes
        FROM vetchium.federation_outbox
        WHERE kind = 'agency-pointer-changed' AND aggregate_id = $1`,
		c.id()).Scan(&body); err != nil {
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
		payload.Request.RequestNumber != contacts.ChatRequestNumber(number) ||
		payload.Request.State != contacts.ChatRequestPending ||
		payload.Request.Direction != contacts.ToHubUser ||
		!payload.Request.SentAt.Equal(*payload.LastActivityAt) {
		t.Fatalf("payload = %s", body)
	}
}

func TestAnswerRequestToTheAgencyMakesTheAgencyActiveIntegration(t *testing.T) {
	f := newFixture(t)
	agency := f.agency(t)
	c := f.contact(t, agency, newID(t), false)
	number := f.request(t, c, contacts.ToAgency)

	ctx := context.Background()
	tx, err := f.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	found, err := q.GetPendingOrgChatRequest(ctx, sqlc.GetPendingOrgChatRequestParams{
		OrgDid: c.org, HubUserDid: c.hub,
	})
	if err != nil {
		t.Fatal(err)
	}
	answered, err := AnswerRequest(ctx, q, found.VetchiumOrgChatRequest,
		Answer{Accept: true, HubUserName: "Ada Lovelace", HubUserHandle: c.handle},
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
                WHERE s.org_did = c.org_did AND s.hub_user_did = c.hub_user_did
                  AND s.kind = 'suggestion')::text
        FROM vetchium.org_chat_requests AS r
        JOIN vetchium.org_conversations AS c USING (org_did, hub_user_did)
        JOIN vetchium.org_conversation_messages AS m USING (org_did, hub_user_did)
        WHERE r.org_did = $1 AND r.hub_user_did = $2 AND r.request_number = $3`,
		c.org, c.hub, number); got !=
		"true:true:86400:hub_user:I would like this role:0" {
		t.Fatalf("conversation = %s", got)
	}
	suggestions, err := sqlc.New(f.owner).ListOrgConversationSuggestions(ctx,
		sqlc.ListOrgConversationSuggestionsParams{OrgDid: c.org, HubUserDid: c.hub})
	if err != nil || len(suggestions) != 0 {
		t.Fatalf("a Hub user's request suggested %v, %v", suggestions, err)
	}
}
