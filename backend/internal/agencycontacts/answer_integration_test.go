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

// hubRequest records a Hub user's pending request to the Contact's agency.
func (f *fixture) hubRequest(t *testing.T, contactID pgtype.UUID) pgtype.UUID {
	t.Helper()
	requestID := newID(t)
	f.exec(t, `INSERT INTO vetchium.org_chat_requests (request_id, contact_id,
            org_did, hub_user_did, direction, state, consumer_domain,
            opening_number, note, sender_display_name, window_seconds, sent_at)
        SELECT $2, contact_id, org_did, hub_user_did, 'to_agency', 'pending',
            'client.example', 3, 'I would like this role', 'Ada Lovelace',
            86400, now() - interval '1 hour'
        FROM vetchium.org_contacts WHERE contact_id = $1`, contactID, requestID)
	return requestID
}

// answerAsAgency answers as the agency user in a transaction of its own,
// committing only when the answer succeeds.
func (f *fixture) answerAsAgency(
	t *testing.T, orgDID, requestID, userID pgtype.UUID, answer Answer,
) (sqlc.VetchiumOrgChatRequest, error) {
	t.Helper()
	ctx := context.Background()
	tx, err := f.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	answered, err := AnswerAgencyRequest(ctx, sqlc.New(tx), orgDID, requestID,
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
	t *testing.T, contactID pgtype.UUID,
) federationspec.AgencyPointerChangedPayload {
	t.Helper()
	var body []byte
	if err := f.owner.QueryRow(context.Background(), `SELECT payload_bytes
        FROM vetchium.federation_outbox
        WHERE kind = 'agency-pointer-changed' AND aggregate_id = $1
        ORDER BY aggregate_version DESC LIMIT 1`,
		dbvalue.FormatUUID(contactID)).Scan(&body); err != nil {
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
	contactID := f.contact(t, agency, newID(t), false)
	requestID := f.hubRequest(t, contactID)

	answered, err := f.answerAsAgency(t, agency, requestID, second, Answer{Accept: true})
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
        JOIN vetchium.org_conversations AS c USING (contact_id)
        JOIN vetchium.org_conversation_messages AS m USING (conversation_id)
        WHERE r.request_id = $1`, requestID); got !=
		"true:true:86400:hub_user:Ada Lovelace:I would like this role" {
		t.Fatalf("conversation = %s", got)
	}
	if got := f.scalar(t, `SELECT actor_id || ':' || (payload ? 'note')::text
        FROM vetchium.audit_events
        WHERE action = 'org.chat_request.accepted' AND entity_id = $1`,
		dbvalue.FormatUUID(requestID)); got != dbvalue.FormatUUID(second)+":false" {
		t.Fatalf("audit = %s", got)
	}
	pointer := f.latestPointer(t, contactID)
	if !pointer.RequestAcceptedByAgency || !pointer.HasConversation ||
		pointer.NewAgencyRequest || pointer.NewAgencyMessage ||
		pointer.Request == nil || pointer.Request.State != contacts.ChatRequestAccepted {
		t.Fatalf("pointer = %+v", pointer)
	}

	if _, err := f.answerAsAgency(t, agency, requestID, first,
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
		contactID := f.contact(t, agency, newID(t), false)
		requestID := f.hubRequest(t, contactID)

		answered, err := f.answerAsAgency(t, agency, requestID, f.userID, Answer{Scope: scope})
		if err != nil {
			t.Fatal(err)
		}
		if answered.State != string(contacts.ChatRequestDeclined) || answered.Note.Valid ||
			answered.DeclineScope.String != string(scope) || answered.AnsweredBy != f.userID {
			t.Fatalf("%s: answered = %+v", scope, answered)
		}
		want := "to_agency:sender:true::"
		if scope == contacts.DeclineOpening {
			want = "to_agency:opening::client.example:3"
		}
		if got := f.scalar(t, `SELECT b.blocked_direction || ':' || b.scope || ':' ||
                COALESCE((b.blocked_until = r.answered_at
                    + r.window_seconds * interval '1 second')::text, '') || ':' ||
                COALESCE(b.consumer_domain, '') || ':' ||
                COALESCE(b.opening_number::text, '')
            FROM vetchium.org_chat_request_blocks AS b
            JOIN vetchium.org_chat_requests AS r USING (contact_id)
            WHERE r.request_id = $1`, requestID); got != want {
			t.Fatalf("%s: block = %s", scope, got)
		}
		if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.org_conversations
            WHERE contact_id = $1`, contactID); got != "0" {
			t.Fatalf("%s: a decline opened %s conversations", scope, got)
		}
		pointer := f.latestPointer(t, contactID)
		if pointer.RequestAcceptedByAgency || pointer.Request == nil ||
			pointer.Request.State != contacts.ChatRequestDeclined {
			t.Fatalf("%s: pointer = %+v", scope, pointer)
		}

		if _, err := f.answerAsAgency(t, agency, requestID, f.userID,
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
	sent := newID(t)
	f.exec(t, `INSERT INTO vetchium.org_chat_requests (request_id, contact_id,
            org_did, hub_user_did, direction, state, consumer_domain,
            opening_number, sender_user_id, sender_display_name)
        SELECT $2, contact_id, org_did, hub_user_did, 'to_hub_user', 'pending',
            'client.example', 3, $3, 'scout@contacts.example'
        FROM vetchium.org_contacts WHERE contact_id = $1`, own, sent, agencyUser)
	elsewhere := f.hubRequest(t, f.contact(t, other, hubDID, false))

	for name, requestID := range map[string]pgtype.UUID{
		"the agency's own request": sent,
		"another agency's request": elsewhere,
		"an unknown request":       newID(t),
	} {
		if _, err := f.answerAsAgency(t, agency, requestID, agencyUser,
			Answer{Accept: true}); !errors.Is(err, ErrRequestNotFound) {
			t.Errorf("%s: answer = %v", name, err)
		}
	}
	if got := f.scalar(t, `SELECT string_agg(state, ',' ORDER BY request_id)
        FROM vetchium.org_chat_requests WHERE request_id = ANY($1)`,
		[]pgtype.UUID{sent, elsewhere}); got != "pending,pending" {
		t.Fatalf("states = %s", got)
	}
}
