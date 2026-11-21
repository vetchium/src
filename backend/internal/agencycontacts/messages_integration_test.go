package agencycontacts

import (
	"context"
	"encoding/json"
	"testing"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"

	"backend/internal/dbvalue"
	"backend/internal/federation/events"
)

func TestAgencyMessageDeletedAuditsWithoutTheTextIntegration(t *testing.T) {
	f := newFixture(t)
	agencyDID, hubDID := f.agency(t), newID(t)
	// The receiver applies only events for a Hub user this tenant homes.
	f.exec(t, `INSERT INTO vetchium.hub_users (hub_user_did, handle,
        email_address, email_digest, display_name, password_hash,
        resident_country, hub_plan_oid)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')), 'Ada Lovelace',
            'test-hash', 'SG', 'hub-free-tier')`,
		hubDID, handleOf(hubDID), "ada-"+handleOf(hubDID)+"@contacts.example")
	t.Cleanup(func() {
		ctx := context.Background()
		for _, sql := range []string{
			`DELETE FROM vetchium.audit_events WHERE subject_hub_user_did = $1`,
			`DELETE FROM vetchium.federation_event_watermarks
             WHERE destination_principal_did = $1`,
			`DELETE FROM vetchium.hub_users WHERE hub_user_did = $1`,
		} {
			if _, err := f.owner.Exec(ctx, sql, hubDID); err != nil {
				t.Errorf("clean up: %v", err)
			}
		}
	})
	payload := federationspec.AgencyMessageDeletedPayload{
		AgencyOrgDID:  orgs.OrgDID(dbvalue.FormatUUID(agencyDID)),
		HubUserDID:    hub.HubUserDID(dbvalue.FormatUUID(hubDID)),
		AgencyDomain:  "scouts.example",
		MessageNumber: 4,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	event := events.Event{
		EventID: newID(t), SourceTenantID: "usa1",
		Kind: federationspec.AgencyMessageDeletedKind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalHubUser, DID: hubDID,
		},
		AggregateType: federationspec.AgencyMessageAggregate,
		AggregateID: federationspec.AgencyMessageAggregateID(
			payload.AgencyOrgDID, payload.HubUserDID, payload.MessageNumber),
		AggregateVersion: 1, Payload: body,
	}
	for range 2 {
		outcome, err := f.receiver.Receive(context.Background(), event)
		if err != nil || (outcome != federationspec.EventApplied &&
			outcome != federationspec.EventDuplicate) {
			t.Fatalf("receive = %q, %v", outcome, err)
		}
	}
	if got := f.scalar(t, `SELECT string_agg(actor_type || ' ' || actor_id || ' ' ||
            entity_id || ' ' || (payload ->> 'deleted_by') || ' ' ||
            (payload ->> 'message_number') || ' ' || (payload ? 'deleted_text')::text,
            ',')
        FROM vetchium.audit_events
        WHERE action = 'hub.agency-conversation.message-deleted'
          AND subject_hub_user_did = $1`, hubDID); got !=
		"org "+dbvalue.FormatUUID(agencyDID)+" scouts.example agency 4 false" {
		t.Fatalf("audit = %s", got)
	}
}
