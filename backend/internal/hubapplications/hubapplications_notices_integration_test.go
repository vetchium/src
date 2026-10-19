package hubapplications

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	hubspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/orgs"

	"backend/internal/dbvalue"
	"backend/internal/federation/events"
)

// A notice queues one email request, a status change only when the status
// really changed, the applicant's own withdrawal never, and a removal event
// deletes the projection row.
func TestProjectionNoticesAndRemovalIntegration(t *testing.T) {
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

	did, _ := dbvalue.NewUUIDv7(time.Now())
	orgDID, _ := dbvalue.NewUUIDv7(time.Now())
	raw := hex.EncodeToString(did.Bytes[10:])
	if _, err := owner.Exec(ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')), 'Applicant',
                'test-hash', 'SG', 'hub-free-tier')`,
		did, raw[:8]+"-"+raw[:11],
		"notices-"+dbvalue.FormatUUID(did)+"@example.com"); err != nil {
		t.Fatal(err)
	}
	aggregate := AggregateID(orgDID, 4, 7)
	defer func() {
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.audit_events
            WHERE entity_id IN (SELECT event_id::text
                FROM vetchium.federation_inbox WHERE aggregate_id = $1)`,
			aggregate)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_inbox
            WHERE aggregate_id = $1`, aggregate)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_event_watermarks
            WHERE aggregate_id = $1`, aggregate)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.hub_users
            WHERE hub_user_did = $1`, did)
	}()
	registry := events.NewRegistry()
	Register(registry)
	receiver := events.NewReceiver(events.ReceiverConfig{
		Pool: app, TenantID: "sgp", Source: "mesh-api", Registry: registry,
		Directory: orgHome{did: orgDID, tenant: "usa1"},
	})
	applied := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	send := func(kind federationspec.EventKind, version int64, payload any) {
		t.Helper()
		eventID, _ := dbvalue.NewUUID()
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := receiver.Receive(ctx, events.Event{
			EventID: eventID, SourceTenantID: "usa1", Kind: kind,
			Destination: events.Principal{
				Type: directoryspec.PrincipalHubUser, DID: did,
			},
			AggregateType: federationspec.OrgApplicationAggregate,
			AggregateID:   aggregate, AggregateVersion: version, Payload: body,
		}); err != nil {
			t.Fatal(err)
		}
	}
	change := func(version int64, status hubspec.ApplicationStatus,
		notice federationspec.ApplicationNotice) {
		t.Helper()
		send(federationspec.HubApplicationChangedKind, version,
			federationspec.HubApplicationChangedPayload{
				OrgDID:    orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
				OrgDomain: "notices.example", OrgDisplayName: "Notices Org",
				OpeningNumber: 4, OpeningTitle: "Engineer", ApplicationNumber: 7,
				Status: status, PendingActions: []hubspec.PendingActionKind{},
				AppliedAt:      applied,
				LastActivityAt: applied.Add(time.Duration(version) * time.Hour),
				Notice:         notice,
			})
	}
	notices := func() []string {
		t.Helper()
		rows, err := owner.Query(ctx, `SELECT notice || ':' || org_display_name
            || ':' || opening_title FROM vetchium.hub_application_notices
            WHERE hub_user_did = $1 ORDER BY created_at, notice_id`, did)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var got []string
		for rows.Next() {
			var notice string
			if err := rows.Scan(&notice); err != nil {
				t.Fatal(err)
			}
			got = append(got, notice)
		}
		return got
	}

	// The applicant's own apply and a first status notice send nothing.
	change(1, hubspec.Applied, "")
	change(2, hubspec.Applied, federationspec.NoticeStatusChanged)
	if got := notices(); len(got) != 0 {
		t.Fatalf("notices before any change = %v", got)
	}
	change(3, hubspec.InReview, federationspec.NoticeStatusChanged)
	change(4, hubspec.InReview, federationspec.NoticeStatusChanged)
	change(5, hubspec.Interviewing, federationspec.NoticeInterviewScheduled)
	change(6, hubspec.Withdrawn, federationspec.NoticeStatusChanged)
	want := []string{
		"status_changed:Notices Org:Engineer",
		"interview_scheduled:Notices Org:Engineer",
	}
	if got := notices(); len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("notices = %v, want %v", got, want)
	}

	projected := func() int {
		t.Helper()
		var rows int
		if err := owner.QueryRow(ctx, `SELECT count(*)::int
            FROM vetchium.hub_application_projections
            WHERE hub_user_did = $1`, did).Scan(&rows); err != nil {
			t.Fatal(err)
		}
		return rows
	}
	if projected() != 1 {
		t.Fatalf("projection rows = %d", projected())
	}
	removal := federationspec.HubApplicationRemovedPayload{
		OrgDID:        orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
		OpeningNumber: 4, ApplicationNumber: 7,
	}
	send(federationspec.HubApplicationRemovedKind, 7, removal)
	if projected() != 0 {
		t.Fatalf("projection rows after removal = %d", projected())
	}
	// A second removal of the same application is harmless.
	send(federationspec.HubApplicationRemovedKind, 8, removal)
}
