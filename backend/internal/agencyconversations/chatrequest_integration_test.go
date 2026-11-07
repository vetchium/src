package agencyconversations

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/openings"

	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
)

// sourcing records the agency's active sourcing engagement with
// client.example, as the projection from the client's tenant would.
func (f *fixture) sourcing(t *testing.T) {
	t.Helper()
	f.exec(t, `INSERT INTO vetchium.org_engagement_projections (engagement_id,
            provider_org_did, version, consumer_org_did, consumer_domain,
            consumer_display_name, provider_domain, provider_display_name,
            capability_oid, engagement_state, proposed_at, expires_at,
            updated_at)
        VALUES (gen_random_uuid(), $1, 1, gen_random_uuid(), 'client.example',
            'Client', 'scouts.example', 'Talent Scouts', 'sourcing', 'active',
            now(), now() + interval '30 days', now())`, f.orgDID)
}

// hubRequest sends the Hub user's request about client.example's Opening.
func (f *fixture) hubRequest(
	t *testing.T, hubDID pgtype.UUID, openingNumber int32, note string,
) (commands.Response, federationspec.HubChatRequestPayload) {
	t.Helper()
	payload := federationspec.HubChatRequestPayload{
		RequestID:          contacts.ChatRequestID(dbvalue.FormatUUID(newID(t))),
		AgencyOrgDID:       orgs.OrgDID(dbvalue.FormatUUID(f.orgDID)),
		HubUserDID:         hub.HubUserDID(dbvalue.FormatUUID(hubDID)),
		HubUserDisplayName: "Ada King",
		HubUserHandle:      "abcd1234-0123456789b",
		ConsumerDomain:     "client.example",
		OpeningNumber:      openings.OpeningNumber(openingNumber),
		WindowSeconds:      ninetyDays,
	}
	if note != "" {
		text := contacts.ChatRequestNote(note)
		payload.Note = &text
	}
	return f.send(t, federationspec.HubChatRequestKind, f.orgDID, payload), payload
}

func TestHubChatRequestCreatesAnUncountedContactIntegration(t *testing.T) {
	f := newFixture(t)
	f.sourcing(t)
	hubDID := newID(t)
	response, payload := f.hubRequest(t, hubDID, 7, "Is this role still open?")
	if response.Status != 200 {
		t.Fatalf("status = %d: %s", response.Status, response.Body)
	}
	var result federationspec.HubChatRequestResult
	if err := json.Unmarshal(response.Body, &result); err != nil {
		t.Fatal(err)
	}
	if fields := result.Validate(); len(fields) != 0 ||
		result.Request.RequestID != payload.RequestID ||
		result.Request.State != contacts.ChatRequestPending ||
		result.Request.OpeningNumber != 7 {
		t.Fatalf("result = %+v, invalid %v", result, result.Validate())
	}
	contactID := string(result.ContactID)

	if got := f.scalar(t, `SELECT concat_ws(' ', created_by IS NULL,
            display_name, handle)
        FROM vetchium.org_contacts WHERE contact_id = $1`, contactID); got != "t Ada King abcd1234-0123456789b" {
		t.Fatalf("Contact = %q", got)
	}
	if got := f.scalar(t, `SELECT concat_ws(' ', direction, state, note,
            sender_user_id IS NULL, sender_display_name, window_seconds)
        FROM vetchium.org_chat_requests WHERE request_id = $1`,
		string(payload.RequestID)); got != "to_agency pending Is this role still open? t Ada King 7776000" {
		t.Fatalf("request = %q", got)
	}
	// Neither the Contact nor the request counts toward the agency's day.
	for _, table := range []string{"org_contact_creations", "org_chat_request_creations"} {
		if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.`+table+`
            WHERE org_did = $1`, f.orgDID); got != "0" {
			t.Fatalf("%s rows = %s", table, got)
		}
	}
	audits := f.scalar(t, `SELECT string_agg(action || ' ' || actor_type
            || ' ' || actor_id || ' ' || payload::text, ' | ' ORDER BY action)
        FROM vetchium.audit_events WHERE subject_org_did = $1`, f.orgDID)
	hubActor := "hub_user " + dbvalue.FormatUUID(hubDID)
	if !strings.Contains(audits, "org.chat_request.sent "+hubActor) ||
		!strings.Contains(audits, "org.contact.created "+hubActor) ||
		strings.Contains(audits, "still open") {
		t.Fatalf("audit events = %s", audits)
	}
	contact, err := dbvalue.ParseUUID(contactID)
	if err != nil {
		t.Fatal(err)
	}
	_, pointer := f.pointer(t, contact)
	if pointer.NewAgencyRequest || pointer.Request == nil ||
		pointer.Request.Direction != contacts.ToAgency ||
		pointer.Request.State != contacts.ChatRequestPending {
		t.Fatalf("pointer = %+v", pointer)
	}
}

func TestHubChatRequestNeedsTheSourcingEngagementIntegration(t *testing.T) {
	f := newFixture(t)
	response, _ := f.hubRequest(t, newID(t), 7, "")
	if got := problemType(t, response); got != "hub-agency-not-assigned" {
		t.Fatalf("problem = %q", got)
	}
	if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.org_contacts
        WHERE org_did = $1`, f.orgDID); got != "0" {
		t.Fatalf("Contacts = %s", got)
	}
}

func TestHubChatRequestRefusalsIntegration(t *testing.T) {
	f := newFixture(t)
	f.sourcing(t)

	open := newID(t)
	f.contact(t, open, 0, true)
	response, _ := f.hubRequest(t, open, 7, "")
	if got := problemType(t, response); got != "hub-conversation-open" {
		t.Fatalf("open conversation: problem = %q", got)
	}

	pending := newID(t)
	f.request(t, f.contact(t, pending, 1, false))
	response, _ = f.hubRequest(t, pending, 7, "")
	if got := problemType(t, response); got != "hub-chat-request-exists" {
		t.Fatalf("pending request: problem = %q", got)
	}

	blocked := newID(t)
	contactID := f.contact(t, blocked, 1, false)
	f.exec(t, `INSERT INTO vetchium.org_chat_request_blocks (contact_id,
            blocked_direction, scope, consumer_domain, opening_number)
        VALUES ($1, 'to_agency', 'opening', 'client.example', 7)`, contactID)
	response, _ = f.hubRequest(t, blocked, 7, "")
	if got := problemType(t, response); got != "hub-chat-request-blocked" {
		t.Fatalf("opening block: problem = %q", got)
	}
	// The block binds that Opening only, and an existing Contact takes the
	// Hub user's names.
	response, _ = f.hubRequest(t, blocked, 8, "")
	if response.Status != 200 {
		t.Fatalf("another Opening: status = %d: %s", response.Status, response.Body)
	}
	if got := f.scalar(t, `SELECT display_name FROM vetchium.org_contacts
        WHERE contact_id = $1`, contactID); got != "Ada King" {
		t.Fatalf("Contact name = %q", got)
	}

	gone := newID(t)
	f.contact(t, gone, 0, true)
	f.exec(t, `UPDATE vetchium.org_conversations
        SET read_only_reason = 'hub_user_deleted'
        WHERE hub_user_did = $1`, gone)
	response, _ = f.hubRequest(t, gone, 7, "")
	if got := problemType(t, response); got != "hub-conversation-party-deleted" {
		t.Fatalf("deleted party: problem = %q", got)
	}
}

func TestHubChatRequestToAnotherAgencyIsRejectedIntegration(t *testing.T) {
	f := newFixture(t)
	f.sourcing(t)
	hubDID := newID(t)
	payload := federationspec.HubChatRequestPayload{
		RequestID:          contacts.ChatRequestID(dbvalue.FormatUUID(newID(t))),
		AgencyOrgDID:       orgs.OrgDID(dbvalue.FormatUUID(newID(t))),
		HubUserDID:         hub.HubUserDID(dbvalue.FormatUUID(hubDID)),
		HubUserDisplayName: "Ada King",
		HubUserHandle:      "abcd1234-0123456789b",
		ConsumerDomain:     "client.example",
		OpeningNumber:      7,
		WindowSeconds:      ninetyDays,
	}
	agency, err := dbvalue.ParseUUID(string(payload.AgencyOrgDID))
	if err != nil {
		t.Fatal(err)
	}
	response := f.send(t, federationspec.HubChatRequestKind, agency, payload)
	if got := problemType(t, response); got != "validation-failed" {
		t.Fatalf("problem = %q", got)
	}
}
