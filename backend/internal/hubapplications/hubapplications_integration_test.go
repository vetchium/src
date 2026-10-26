package hubapplications

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	hubspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/dbvalue"
	"backend/internal/federation/events"
)

// The receiver applies each change once and only when it is newer, so a late
// older event never overwrites the projection.
func TestProjectionKeepsTheNewestChangeIntegration(t *testing.T) {
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
		"projection-"+dbvalue.FormatUUID(did)+"@example.com"); err != nil {
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
	var receive func(int64, hubspec.ApplicationStatus, time.Time) (
		federationspec.EventDeliveryOutcome, error)
	receiver := events.NewReceiver(events.ReceiverConfig{
		Pool: app, TenantID: "sgp", Source: "mesh-api", Registry: registry,
		Directory: orgHome{did: orgDID, tenant: "usa1"},
	})
	applied := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	source := "usa1"
	deliver := func(version int64, status hubspec.ApplicationStatus,
		activity time.Time) federationspec.EventDeliveryOutcome {
		t.Helper()
		outcome, err := receive(version, status, activity)
		if err != nil {
			t.Fatal(err)
		}
		return outcome
	}
	receive = func(version int64, status hubspec.ApplicationStatus,
		activity time.Time) (federationspec.EventDeliveryOutcome, error) {
		t.Helper()
		eventID, _ := dbvalue.NewUUID()
		payload, err := json.Marshal(federationspec.HubApplicationChangedPayload{
			OrgDID:    orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
			OrgDomain: "projection.example", OrgDisplayName: "Projection Org",
			OpeningNumber: 4, OpeningTitle: "Engineer", ApplicationNumber: 7,
			Status: status, PendingActions: []hubspec.PendingActionKind{},
			AppliedAt: applied, LastActivityAt: activity,
		})
		if err != nil {
			t.Fatal(err)
		}
		return receiver.Receive(ctx, events.Event{
			EventID: eventID, SourceTenantID: source,
			Kind: federationspec.HubApplicationChangedKind,
			Destination: events.Principal{
				Type: directoryspec.PrincipalHubUser, DID: did,
			},
			AggregateType: federationspec.OrgApplicationAggregate,
			AggregateID:   aggregate, AggregateVersion: version,
			Payload: payload,
		})
	}
	row := func() (string, time.Time, int) {
		t.Helper()
		var status string
		var activity time.Time
		var rows int
		if err := owner.QueryRow(ctx, `SELECT max(hub_status), max(last_activity_at),
            count(*)::int FROM vetchium.hub_application_projections
            WHERE hub_user_did = $1`, did).Scan(&status, &activity, &rows); err != nil {
			t.Fatal(err)
		}
		return status, activity, rows
	}

	if got := deliver(1, hubspec.Applied, applied); got != federationspec.EventApplied {
		t.Fatalf("first delivery = %s", got)
	}
	withdrawnAt := applied.Add(time.Hour)
	if got := deliver(2, hubspec.Withdrawn, withdrawnAt); got != federationspec.EventApplied {
		t.Fatalf("second delivery = %s", got)
	}
	if got := deliver(1, hubspec.Applied, applied); got != federationspec.EventSuperseded {
		t.Fatalf("late delivery = %s", got)
	}
	status, activity, rows := row()
	if status != "withdrawn" || !activity.Equal(withdrawnAt) || rows != 1 {
		t.Fatalf("projection = %s %s, %d rows", status, activity, rows)
	}

	// Another tenant cannot report on an Org it does not home.
	source = "deu"
	if _, err := receive(3, hubspec.Hired, withdrawnAt.Add(time.Hour)); !errors.Is(
		err, events.ErrOriginMismatch,
	) {
		t.Fatalf("forged change err = %v", err)
	}
	if status, _, _ := row(); status != "withdrawn" {
		t.Fatalf("a forged change projected %s", status)
	}
}

// orgHome is a directory that homes one Org at one tenant.
type orgHome struct {
	did    pgtype.UUID
	tenant string
}

func (h orgHome) ResolvePrincipal(
	_ context.Context, request directoryspec.ResolvePrincipalRequest,
) (directoryspec.ResolvePrincipalResponse, *problem.Details, error) {
	if request.PrincipalType != directoryspec.PrincipalOrg ||
		string(request.PrincipalDID) != dbvalue.FormatUUID(h.did) {
		details := coordinatorproblem.DirectoryEntryNotFoundError
		return directoryspec.ResolvePrincipalResponse{}, &details, nil
	}
	return directoryspec.ResolvePrincipalResponse{
		HomeTenantID: directoryspec.TenantID(h.tenant), RoutingVersion: 1,
	}, nil, nil
}
