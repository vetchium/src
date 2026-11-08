package agencycontacts

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// agencyUser adds another active user to the agency's shared inbox.
func (f *fixture) agencyUser(t *testing.T, orgDID pgtype.UUID) pgtype.UUID {
	t.Helper()
	userID := newID(t)
	text := dbvalue.FormatUUID(userID)
	f.exec(t, `INSERT INTO vetchium.org_users (org_user_id, org_did,
        email_address, org_user_state, preferred_language)
        VALUES ($1, $2, $3, 'active', 'de-DE')`,
		userID, orgDID, "inbox-"+text[len(text)-12:]+"@contacts.example")
	return userID
}

// request seeds a pending request between the pair under the Contact's
// next request number. A Hub user's request carries a note and one day's
// window and was sent an hour ago.
func (f *fixture) request(
	t *testing.T, c pair, direction contacts.ChatRequestDirection,
) int32 {
	t.Helper()
	sender, name := pgtype.UUID{}, "Ada Lovelace"
	note, window, sentAgo := dbvalue.Text("I would like this role"),
		pgtype.Int8{Int64: 86400, Valid: true}, "1 hour"
	if direction == contacts.ToHubUser {
		sender, name = f.userID, "scout@contacts.example"
		note, window, sentAgo = dbvalue.Text("A role you would enjoy"), pgtype.Int8{}, "0"
	}
	var number int32
	if err := f.owner.QueryRow(context.Background(), `WITH bumped AS (
            UPDATE vetchium.org_contacts
            SET last_request_number = last_request_number + 1
            WHERE org_did = $1 AND hub_user_did = $2
            RETURNING org_did, hub_user_did, last_request_number
        )
        INSERT INTO vetchium.org_chat_requests (org_did, hub_user_did,
            request_number, direction, state, consumer_domain,
            opening_number, note, sender_user_id, sender_display_name,
            window_seconds, sent_at)
        SELECT org_did, hub_user_did, last_request_number, $3, 'pending',
            'client.example', 3, $4, $5, $6, $7, now() - $8::interval
        FROM bumped
        RETURNING request_number`,
		c.org, c.hub, string(direction), note, sender, name, window, sentAgo).
		Scan(&number); err != nil {
		t.Fatal(err)
	}
	return number
}

// answerAsAgency answers as the agency user in a transaction of its own,
// committing only when the answer succeeds.
func (f *fixture) answerAsAgency(
	t *testing.T, c pair, number int32, userID pgtype.UUID, answer Answer,
) (sqlc.VetchiumOrgChatRequest, error) {
	t.Helper()
	ctx := context.Background()
	tx, err := f.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	answered, err := AnswerAgencyRequest(ctx, sqlc.New(tx), c.org, c.handle, number,
		answer, Answerer{
			TenantID: "usa1", ActorType: "org_user",
			ActorID: dbvalue.FormatUUID(userID), Source: "test",
			IdempotencyKey: dbvalue.Text(dbvalue.FormatUUID(newID(t))),
			OrgUserID:      userID,
		})
	if err != nil {
		return answered, err
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return answered, nil
}

// latestPointer is the last pointer event the Contact's answer enqueued.
func (f *fixture) latestPointer(
	t *testing.T, c pair,
) federationspec.AgencyPointerChangedPayload {
	t.Helper()
	var body []byte
	if err := f.owner.QueryRow(context.Background(), `SELECT payload_bytes
        FROM vetchium.federation_outbox
        WHERE kind = 'agency-pointer-changed' AND aggregate_id = $1
        ORDER BY aggregate_version DESC LIMIT 1`,
		c.id()).Scan(&body); err != nil {
		t.Fatal(err)
	}
	var payload federationspec.AgencyPointerChangedPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestAnyAgencyUserAcceptsAHubRequestOnceIntegration(t *testing.T) {
	f := newFixture(t)
	agency := f.agency(t)
	first, second := f.userID, f.agencyUser(t, agency)
	c := f.contact(t, agency, newID(t), false)
	number := f.request(t, c, contacts.ToAgency)

	answered, err := f.answerAsAgency(t, c, number, second, Answer{Accept: true})
	if err != nil {
		t.Fatal(err)
	}
	if answered.State != string(contacts.ChatRequestAccepted) ||
		answered.Note.Valid || answered.AnsweredBy != second {
		t.Fatalf("answered = %+v", answered)
	}
	if got := f.scalar(t, `SELECT (c.agency_activity_at = r.answered_at)::text || ':' ||
            (c.hub_activity_at = r.sent_at)::text || ':' || c.window_seconds::text || ':' ||
            m.sender_type || ':' || m.sender_display_name || ':' || m.message_text
        FROM vetchium.org_chat_requests AS r
        JOIN vetchium.org_conversations AS c USING (org_did, hub_user_did)
        JOIN vetchium.org_conversation_messages AS m USING (org_did, hub_user_did)
        WHERE r.org_did = $1 AND r.hub_user_did = $2 AND r.request_number = $3`,
		c.org, c.hub, number); got !=
		"true:true:86400:hub_user:Ada Lovelace:I would like this role" {
		t.Fatalf("conversation = %s", got)
	}
	if got := f.scalar(t, `SELECT actor_id || ':' || (payload ? 'note')::text
        FROM vetchium.audit_events
        WHERE action = 'org.chat_request.accepted' AND entity_id = $1`,
		c.handle); got != dbvalue.FormatUUID(second)+":false" {
		t.Fatalf("audit = %s", got)
	}
	pointer := f.latestPointer(t, c)
	if !pointer.RequestAcceptedByAgency || !pointer.HasConversation ||
		pointer.NewAgencyRequest || pointer.NewAgencyMessage ||
		pointer.Request == nil || pointer.Request.State != contacts.ChatRequestAccepted {
		t.Fatalf("pointer = %+v", pointer)
	}

	if _, err := f.answerAsAgency(t, c, number, first,
		Answer{Scope: contacts.DeclineSender}); !errors.Is(err, ErrRequestNotFound) {
		t.Fatalf("second answer = %v", err)
	}
}

func TestDecliningAHubRequestBlocksTheHubUserIntegration(t *testing.T) {
	f := newFixture(t)
	agency := f.agency(t)
	for _, scope := range []contacts.ChatRequestDeclineScope{
		contacts.DeclineSender, contacts.DeclineOpening,
	} {
		c := f.contact(t, agency, newID(t), false)
		number := f.request(t, c, contacts.ToAgency)

		answered, err := f.answerAsAgency(t, c, number, f.userID, Answer{Scope: scope})
		if err != nil {
			t.Fatal(err)
		}
		if answered.State != string(contacts.ChatRequestDeclined) || answered.Note.Valid ||
			answered.DeclineScope.String != string(scope) || answered.AnsweredBy != f.userID {
			t.Fatalf("%s: answered = %+v", scope, answered)
		}
		want := "true:"
		if scope == contacts.DeclineOpening {
			want = ":to_agency client.example 3"
		}
		if got := f.scalar(t, `SELECT COALESCE((c.hub_requests_blocked_until
                    = r.answered_at + r.window_seconds * interval '1 second')::text,
                '') || ':' || COALESCE((SELECT string_agg(concat_ws(' ',
                    b.blocked_direction, b.consumer_domain, b.opening_number), ',')
                FROM vetchium.org_chat_request_opening_blocks AS b
                WHERE b.org_did = c.org_did AND b.hub_user_did = c.hub_user_did), '')
            FROM vetchium.org_contacts AS c
            JOIN vetchium.org_chat_requests AS r USING (org_did, hub_user_did)
            WHERE r.org_did = $1 AND r.hub_user_did = $2 AND r.request_number = $3`,
			c.org, c.hub, number); got != want {
			t.Fatalf("%s: block = %s", scope, got)
		}
		if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.org_conversations
            WHERE org_did = $1 AND hub_user_did = $2`, c.org, c.hub); got != "0" {
			t.Fatalf("%s: a decline opened %s conversations", scope, got)
		}
		pointer := f.latestPointer(t, c)
		if pointer.RequestAcceptedByAgency || pointer.Request == nil ||
			pointer.Request.State != contacts.ChatRequestDeclined {
			t.Fatalf("%s: pointer = %+v", scope, pointer)
		}

		if _, err := f.answerAsAgency(t, c, number, f.userID,
			Answer{Accept: true}); !errors.Is(err, ErrRequestNotFound) {
			t.Fatalf("%s: second answer = %v", scope, err)
		}
	}
}

func TestAgencyAnswersOnlyItsPendingHubRequestsIntegration(t *testing.T) {
	f := newFixture(t)
	agency := f.agency(t)
	agencyUser, hubDID := f.userID, newID(t)
	own := f.contact(t, agency, hubDID, false)
	other := f.agency(t)
	sent := f.request(t, own, contacts.ToHubUser)
	elsewhere := f.contact(t, other, hubDID, false)
	received := f.request(t, elsewhere, contacts.ToAgency)

	for name, target := range map[string]struct {
		c      pair
		number int32
	}{
		"the agency's own request": {own, sent},
		"another agency's request": {pair{agency, hubDID, elsewhere.handle}, received},
		"an unknown request":       {own, sent + 1},
		"an unknown person":        {pair{agency, newID(t), "zzzz9999-0123456789a"}, 1},
	} {
		if _, err := f.answerAsAgency(t, target.c, target.number, agencyUser,
			Answer{Accept: true}); !errors.Is(err, ErrRequestNotFound) {
			t.Errorf("%s: answer = %v", name, err)
		}
	}
	if got := f.scalar(t, `SELECT string_agg(state, ',' ORDER BY org_did = $1 DESC)
        FROM vetchium.org_chat_requests
        WHERE hub_user_did = $2 AND org_did IN ($1, $3)`,
		agency, hubDID, other); got != "pending,pending" {
		t.Fatalf("states = %s", got)
	}
}
