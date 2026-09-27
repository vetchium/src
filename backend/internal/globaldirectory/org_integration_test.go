package globaldirectory

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
)

func TestOrgDirectoryCommandsIntegration(t *testing.T) {
	databaseURL := os.Getenv("GLOBAL_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("GLOBAL_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	reset := func() {
		t.Helper()
		_, err := pool.Exec(ctx, `TRUNCATE
            vetchium.global_outbox_events,
            vetchium.global_command_ledger,
            vetchium.global_audit_events,
            vetchium.hub_profile_slugs,
            vetchium.hub_principals,
            vetchium.org_domains,
            vetchium.org_principals`)
		if err != nil {
			t.Fatal(err)
		}
	}
	reset()
	defer reset()
	service := New(pool)

	const firstDID orgs.OrgDID = "018f7e32-7b5a-7d31-8fd0-f7e2a852f144"
	const secondDID orgs.OrgDID = "018f7e32-7b5a-7d31-8fd0-f7e2a852f145"
	reserve := directoryspec.ReserveOrgPrincipalRequest{
		CommandID: "4569b853-4778-4e67-a635-5f41b06585f5",
		OrgDID:    firstDID, Domain: "example.com", HomeTenantID: "deu",
		ProvisioningExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	reserved, err := service.ReserveOrgPrincipal(ctx, "deu", reserve)
	assertOrgSuccess(t, reserved, err, directoryspec.PrincipalProvisioning, "example.com")
	replayed, err := service.ReserveOrgPrincipal(ctx, "deu", reserve)
	assertOrgSuccess(t, replayed, err, directoryspec.PrincipalProvisioning, "example.com")
	assertCounts(t, pool, 1, 1, 1)
	if _, err := service.ResolveOrgDomain(ctx, "example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("provisioning domain resolved: %v", err)
	}

	// A second signup racing for the same domain loses at reservation, while
	// the first reservation is still only provisioning.
	rival := directoryspec.ReserveOrgPrincipalRequest{
		CommandID: "905c6bd6-6b12-4192-a16c-76f0bf00403e",
		OrgDID:    secondDID, Domain: "example.com", HomeTenantID: "sgp",
		ProvisioningExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	lost, err := service.ReserveOrgPrincipal(ctx, "sgp", rival)
	assertOrgProblem(t, lost, err, "vetchium-problem-details/directory-claim-conflict")

	wrongTenant := reserve
	wrongTenant.CommandID = "0d7a5a88-4a0c-4c83-9e1b-3a0c4b6b5a11"
	mismatch, err := service.ReserveOrgPrincipal(ctx, "sgp", wrongTenant)
	assertOrgProblem(t, mismatch, err, "vetchium-problem-details/directory-caller-tenant-mismatch")

	activate := directoryspec.ActivateOrgPrincipalRequest{
		CommandID: "8dc99bc7-6995-4787-a7b8-1d19077cf449", OrgDID: firstDID,
	}
	foreignActivation, err := service.ActivateOrgPrincipal(ctx, "sgp", directoryspec.ActivateOrgPrincipalRequest{
		CommandID: "1f0f3d8e-6b7a-4a52-9a0c-0f4a8e2c5d10", OrgDID: firstDID,
	})
	assertOrgProblem(t, foreignActivation, err, "vetchium-problem-details/directory-caller-tenant-mismatch")
	activated, err := service.ActivateOrgPrincipal(ctx, "deu", activate)
	assertOrgSuccess(t, activated, err, directoryspec.PrincipalActive, "example.com")
	resolved, err := service.ResolveOrgDomain(ctx, "example.com")
	if err != nil || resolved.OrgDID != firstDID || resolved.HomeTenantID != "deu" {
		t.Fatalf("resolved = %+v, err = %v", resolved, err)
	}

	release := directoryspec.ReleaseOrgDomainRequest{
		CommandID: "030dbf44-b0c6-486a-9a7c-e95ca9a6748f",
		OrgDID:    firstDID, Domain: "example.com",
	}
	released, err := service.ReleaseOrgDomain(ctx, "deu", release)
	assertOrgSuccess(t, released, err, directoryspec.PrincipalActive, "")
	if _, err := service.ResolveOrgDomain(ctx, "example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("released domain resolved: %v", err)
	}
	repeatRelease := release
	repeatRelease.CommandID = "46c18421-dd91-4427-87cb-b8dcbd243d0b"
	noop, err := service.ReleaseOrgDomain(ctx, "deu", repeatRelease)
	assertOrgSuccess(t, noop, err, directoryspec.PrincipalActive, "")

	// The released domain can be claimed by another active Org, after which
	// the original owner's re-claim loses.
	rival.CommandID = "78ae43b4-b065-43d6-9a39-d7c14a12ed56"
	rival.Domain = "other.example.com"
	secondReserved, err := service.ReserveOrgPrincipal(ctx, "sgp", rival)
	assertOrgSuccess(t, secondReserved, err, directoryspec.PrincipalProvisioning, "other.example.com")
	secondActive, err := service.ActivateOrgPrincipal(ctx, "sgp", directoryspec.ActivateOrgPrincipalRequest{
		CommandID: "267b10cb-e664-45ba-be1e-172045e3770a", OrgDID: secondDID,
	})
	assertOrgSuccess(t, secondActive, err, directoryspec.PrincipalActive, "other.example.com")
	holdsOne, err := service.ClaimOrgDomain(ctx, "sgp", directoryspec.ClaimOrgDomainRequest{
		CommandID: "9a5e4b76-459f-42ed-987c-026bad032b31",
		OrgDID:    secondDID, Domain: "example.com",
	})
	assertOrgProblem(t, holdsOne, err, "vetchium-problem-details/directory-state-conflict")

	reclaim := directoryspec.ClaimOrgDomainRequest{
		CommandID: "3129fe10-9132-431c-afaf-a60bd3767294",
		OrgDID:    firstDID, Domain: "example.com",
	}
	reclaimed, err := service.ClaimOrgDomain(ctx, "deu", reclaim)
	assertOrgSuccess(t, reclaimed, err, directoryspec.PrincipalActive, "example.com")
	again := reclaim
	again.CommandID = "f4847331-5a4f-4eae-a5f4-cc131b0cd270"
	unchanged, err := service.ClaimOrgDomain(ctx, "deu", again)
	assertOrgSuccess(t, unchanged, err, directoryspec.PrincipalActive, "example.com")

	if _, err := service.ReleaseOrgDomain(ctx, "sgp", directoryspec.ReleaseOrgDomainRequest{
		CommandID: "0b8acb99-36da-410a-97ae-e31ff5020998",
		OrgDID:    secondDID, Domain: "other.example.com",
	}); err != nil {
		t.Fatal(err)
	}
	taken, err := service.ClaimOrgDomain(ctx, "sgp", directoryspec.ClaimOrgDomainRequest{
		CommandID: "e20bfcb7-2d31-48d9-96a0-6893cde72864",
		OrgDID:    secondDID, Domain: "example.com",
	})
	assertOrgProblem(t, taken, err, "vetchium-problem-details/directory-claim-conflict")

	// Reserve, activate, release, claim and the second Org's reserve,
	// activate and release each changed the directory once.
	var events int
	if err := pool.QueryRow(ctx, `SELECT count(*)
        FROM vetchium.global_outbox_events
        WHERE aggregate_type = 'org_principal'`).Scan(&events); err != nil ||
		events != 7 {
		t.Fatalf("org events = %d, err = %v", events, err)
	}
	var version int64
	if err := pool.QueryRow(ctx, `SELECT directory_version
        FROM vetchium.org_principals WHERE org_did = $1`,
		string(firstDID)).Scan(&version); err != nil || version != 4 {
		t.Fatalf("first Org directory version = %d, err = %v", version, err)
	}

	expired := directoryspec.ReserveOrgPrincipalRequest{
		CommandID: "c1a9a3f2-5a0e-4a8b-9d4e-2f6b7c8d9e01",
		OrgDID:    "018f7e32-7b5a-7d31-8fd0-f7e2a852f146",
		Domain:    "expired.example.com", HomeTenantID: "ind1",
		ProvisioningExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if _, err := service.ReserveOrgPrincipal(ctx, "ind1", expired); err != nil {
		t.Fatal(err)
	}
	// Backdating the reservation rewrites its immutable creation time, which
	// the transition trigger refuses; this setup alone skips triggers.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(
		ctx, "SET LOCAL session_replication_role = replica",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE vetchium.org_principals
        SET created_at = now() - interval '2 hours',
            updated_at = now() - interval '2 hours',
            provisioning_expires_at = now() - interval '1 hour'
        WHERE org_did = $1`, string(expired.OrgDID)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	reaped, err := service.ReapExpiredReservations(ctx)
	if err != nil || reaped != 1 {
		t.Fatalf("reaped = %d, err = %v", reaped, err)
	}
	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vetchium.org_domains
        WHERE domain = 'expired.example.com'`).Scan(&remaining); err != nil ||
		remaining != 0 {
		t.Fatalf("expired domain remained: %d, %v", remaining, err)
	}
	var reapAudit string
	if err := pool.QueryRow(ctx, `SELECT actor_tenant_id || '|' ||
            (payload ->> 'released_domain')
        FROM vetchium.global_audit_events
        WHERE action = 'global_directory.org_principal_reservation_expired'
          AND entity_id = $1`, string(expired.OrgDID)).Scan(&reapAudit); err != nil ||
		reapAudit != "ind1|expired.example.com" {
		t.Fatalf("reap audit = %q, %v", reapAudit, err)
	}
	// Every directory change above has exactly one audit event.
	var changes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vetchium.global_audit_events
        WHERE entity_type = 'org_principal' AND entity_id = $1`,
		string(firstDID)).Scan(&changes); err != nil || changes != 4 {
		t.Fatalf("first Org audit events = %d, %v", changes, err)
	}
}

func assertOrgSuccess(
	t *testing.T, outcome OrgOutcome, err error,
	state directoryspec.PrincipalState, domain orgs.OrgDomain,
) {
	t.Helper()
	if err != nil || outcome.Status != 200 || outcome.Org == nil ||
		outcome.Org.State != state {
		t.Fatalf("outcome = %+v, err = %v", outcome, err)
	}
	if (domain == "") != (outcome.Org.Domain == nil) ||
		(outcome.Org.Domain != nil && *outcome.Org.Domain != domain) {
		t.Fatalf("domain = %v, want %q", outcome.Org.Domain, domain)
	}
}

func assertOrgProblem(
	t *testing.T, outcome OrgOutcome, err error, problemType string,
) {
	t.Helper()
	if err != nil || outcome.Problem == nil ||
		outcome.Problem.Type != problemType {
		t.Fatalf("outcome = %+v, err = %v", outcome, err)
	}
}
