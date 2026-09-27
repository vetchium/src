package globaldirectory

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"

	"backend/internal/dbvalue"
)

func TestDirectoryCommandProtocolIntegration(t *testing.T) {
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
            vetchium.hub_professional_email_supersessions,
            vetchium.hub_professional_email_feed_cursors,
            vetchium.hub_professional_email_claims,
            vetchium.hub_account_email_claims,
            vetchium.hub_account_email_change_reservations,
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

	service := New(pool, "909577e87ebd5395")
	first := directoryspec.ReserveHubPrincipalRequest{
		CommandID:  "4569b853-4778-4e67-a635-5f41b06585f5",
		HubUserDID: "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
		Handle:     "abcde000-0123456789a", HomeTenantID: "ind1",
		ProvisioningExpiresAt: time.Now().UTC().Add(time.Hour),
		AccountEmailDigest:    "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
		DigestKeyID:           "909577e87ebd5395",
	}
	reserved, err := service.ReserveHubPrincipal(ctx, "ind1", first)
	assertSuccess(t, reserved, err, directoryspec.PrincipalProvisioning)

	replayed, err := service.ReserveHubPrincipal(ctx, "ind1", first)
	assertSuccess(t, replayed, err, directoryspec.PrincipalProvisioning)
	assertCounts(t, pool, 1, 1, 1)

	changed := first
	changed.Handle = "fghij000-0123456789b"
	conflict, err := service.ReserveHubPrincipal(ctx, "ind1", changed)
	assertProblemType(
		t, conflict, err,
		"vetchium-problem-details/idempotency-key-conflict",
	)
	if _, err := service.ResolveProfileSlug(ctx, string(first.Handle)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("provisioning handle resolved: %v", err)
	}

	activation := directoryspec.ActivateHubPrincipalRequest{
		CommandID:  "8dc99bc7-6995-4787-a7b8-1d19077cf449",
		HubUserDID: first.HubUserDID,
	}
	activated, err := service.ActivateHubPrincipal(ctx, "ind1", activation)
	assertSuccess(t, activated, err, directoryspec.PrincipalActive)
	resolved, err := service.ResolveProfileSlug(ctx, string(first.Handle))
	if err != nil || resolved.HomeTenantID != "ind1" ||
		resolved.Kind != directoryspec.ProfileSlugKindHandle {
		t.Fatalf("resolved handle = %+v, err = %v", resolved, err)
	}

	alias := directoryspec.HubAlias("mary-jane")
	aliasRequest := directoryspec.SetHubAliasRequest{
		CommandID:  "030dbf44-b0c6-486a-9a7c-e95ca9a6748f",
		HubUserDID: first.HubUserDID, ProfileAlias: &alias,
	}
	set, err := service.SetHubAlias(ctx, "ind1", aliasRequest)
	assertSuccess(t, set, err, directoryspec.PrincipalActive)
	if set.Principal.ProfileAlias == nil ||
		*set.Principal.ProfileAlias != alias {
		t.Fatalf("alias response = %+v", set.Principal)
	}
	resolved, err = service.ResolveProfileSlug(ctx, string(alias))
	if err != nil || resolved.Kind != directoryspec.ProfileSlugKindAlias {
		t.Fatalf("resolved alias = %+v, err = %v", resolved, err)
	}

	sameAlias := aliasRequest
	sameAlias.CommandID = "46c18421-dd91-4427-87cb-b8dcbd243d0b"
	unchanged, err := service.SetHubAlias(ctx, "ind1", sameAlias)
	assertSuccess(t, unchanged, err, directoryspec.PrincipalActive)
	assertCounts(t, pool, 4, 3, 3)

	otherAlias := directoryspec.HubAlias("other-name")
	rateLimited := directoryspec.SetHubAliasRequest{
		CommandID:  "9a25d782-510a-4c85-9e2e-15b22a968a17",
		HubUserDID: first.HubUserDID, ProfileAlias: &otherAlias,
	}
	stateConflict, err := service.SetHubAlias(ctx, "ind1", rateLimited)
	assertProblemType(
		t, stateConflict, err,
		"vetchium-problem-details/directory-state-conflict",
	)
	stateReplay, err := service.SetHubAlias(ctx, "ind1", rateLimited)
	assertProblemType(
		t, stateReplay, err,
		"vetchium-problem-details/directory-state-conflict",
	)

	second := directoryspec.ReserveHubPrincipalRequest{
		CommandID:  "905c6bd6-6b12-4192-a16c-76f0bf00403e",
		HubUserDID: "018f7e32-7b5a-7d31-8fd0-f7e2a852f145",
		Handle:     "klmno000-0123456789c", HomeTenantID: "sgp",
		ProvisioningExpiresAt: time.Now().UTC().Add(time.Hour),
		AccountEmailDigest:    "a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2",
		DigestKeyID:           "909577e87ebd5395",
	}
	secondReserved, err := service.ReserveHubPrincipal(ctx, "sgp", second)
	assertSuccess(t, secondReserved, err, directoryspec.PrincipalProvisioning)
	secondActivation := directoryspec.ActivateHubPrincipalRequest{
		CommandID:  "78ae43b4-b065-43d6-9a39-d7c14a12ed56",
		HubUserDID: second.HubUserDID,
	}
	secondActive, err := service.ActivateHubPrincipal(
		ctx, "sgp", secondActivation,
	)
	assertSuccess(t, secondActive, err, directoryspec.PrincipalActive)
	claimed := directoryspec.SetHubAliasRequest{
		CommandID:  "267b10cb-e664-45ba-be1e-172045e3770a",
		HubUserDID: second.HubUserDID, ProfileAlias: &alias,
	}
	claimConflict, err := service.SetHubAlias(ctx, "sgp", claimed)
	assertProblemType(
		t, claimConflict, err,
		"vetchium-problem-details/directory-claim-conflict",
	)
	secondView, err := service.ResolveProfileSlug(ctx, string(second.Handle))
	if err != nil || secondView.HubUserDID != second.HubUserDID {
		t.Fatalf("second principal = %+v, err = %v", secondView, err)
	}
	resolved, err = service.ResolveProfileSlug(ctx, string(alias))
	if err != nil || resolved.HubUserDID != first.HubUserDID {
		t.Fatalf("conflict moved alias: %+v, err = %v", resolved, err)
	}

	wrongTenant := directoryspec.ActivateHubPrincipalRequest{
		CommandID:  "9a5e4b76-459f-42ed-987c-026bad032b31",
		HubUserDID: second.HubUserDID,
	}
	mismatch, err := service.ActivateHubPrincipal(ctx, "ind1", wrongTenant)
	assertProblemType(
		t, mismatch, err,
		"vetchium-problem-details/directory-caller-tenant-mismatch",
	)
	expired := directoryspec.ReserveHubPrincipalRequest{
		CommandID:  "3129fe10-9132-431c-afaf-a60bd3767294",
		HubUserDID: "018f7e32-7b5a-7d31-8fd0-f7e2a852f146",
		Handle:     "pqrst000-0123456789d", HomeTenantID: "deu",
		ProvisioningExpiresAt: time.Now().UTC().Add(-time.Minute),
		AccountEmailDigest:    "a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3",
		DigestKeyID:           "909577e87ebd5395",
	}
	expiredOutcome, err := service.ReserveHubPrincipal(ctx, "deu", expired)
	assertProblemType(
		t, expiredOutcome, err,
		"vetchium-problem-details/directory-state-conflict",
	)
	assertCounts(t, pool, 10, 5, 5)

	rows, err := pool.Query(ctx, `
        SELECT aggregate_version
        FROM vetchium.global_outbox_events
        WHERE aggregate_id = $1
        ORDER BY aggregate_version`, string(first.HubUserDID))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	versions := []int64{}
	for rows.Next() {
		var version int64
		if err := rows.Scan(&version); err != nil {
			t.Fatal(err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(versions) != 3 || versions[0] != 1 ||
		versions[1] != 2 || versions[2] != 3 {
		t.Fatalf("first principal event versions = %v", versions)
	}
	var firstChangeAt time.Time
	if err := pool.QueryRow(ctx, `SELECT alias_changed_at
        FROM vetchium.hub_principals WHERE hub_user_did = $1`,
		first.HubUserDID).Scan(&firstChangeAt); err != nil {
		t.Fatal(err)
	}
	forcedRelease := directoryspec.SetHubAliasRequest{
		CommandID:               "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
		HubUserDID:              first.HubUserDID,
		DowngradeReleaseIfAlias: &alias,
	}
	released, err := service.SetHubAlias(ctx, "ind1", forcedRelease)
	assertSuccess(t, released, err, directoryspec.PrincipalActive)
	if released.Principal.ProfileAlias != nil {
		t.Fatalf("downgrade release retained alias: %+v", released.Principal)
	}
	if _, err := service.ResolveProfileSlug(ctx, string(alias)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("downgraded alias still resolves: %v", err)
	}
	var afterRelease time.Time
	if err := pool.QueryRow(ctx, `SELECT alias_changed_at
        FROM vetchium.hub_principals WHERE hub_user_did = $1`,
		first.HubUserDID).Scan(&afterRelease); err != nil ||
		!afterRelease.Equal(firstChangeAt) {
		t.Fatalf("forced release changed user cooldown: %v, %v", afterRelease, err)
	}
	claimedAfterRelease := claimed
	claimedAfterRelease.CommandID = "e20bfcb7-2d31-48d9-96a0-6893cde72864"
	available, err := service.SetHubAlias(ctx, "sgp", claimedAfterRelease)
	assertSuccess(t, available, err, directoryspec.PrincipalActive)
	if available.Principal.ProfileAlias == nil ||
		*available.Principal.ProfileAlias != alias {
		t.Fatalf("released alias unavailable to a new user: %+v",
			available.Principal)
	}
	// Simulate a newer same-principal claim reaching the directory before an
	// older conditional release. The old command must not erase that slug.
	if _, err := pool.Exec(ctx, `INSERT INTO vetchium.hub_profile_slugs
        (slug, hub_user_did, kind) VALUES ($1, $2, 'alias')`,
		otherAlias, first.HubUserDID); err != nil {
		t.Fatal(err)
	}
	staleRelease := forcedRelease
	staleRelease.CommandID = "0b8acb99-36da-410a-97ae-e31ff5020998"
	staleOutcome, err := service.SetHubAlias(ctx, "ind1", staleRelease)
	assertSuccess(t, staleOutcome, err, directoryspec.PrincipalActive)
	if staleOutcome.Principal.ProfileAlias == nil ||
		*staleOutcome.Principal.ProfileAlias != otherAlias {
		t.Fatalf("stale downgrade release erased a newer alias: %+v",
			staleOutcome.Principal)
	}
}

func assertSuccess(
	t *testing.T, outcome Outcome, err error,
	state directoryspec.PrincipalState,
) {
	t.Helper()
	if err != nil || outcome.Status != 200 || outcome.Principal == nil ||
		outcome.Principal.State != state {
		t.Fatalf("outcome = %+v, err = %v", outcome, err)
	}
	if !hub.IsHubUserDID(outcome.Principal.HubUserDID) {
		t.Fatalf("invalid response DID %q", outcome.Principal.HubUserDID)
	}
}

func assertProblemType(
	t *testing.T, outcome Outcome, err error, problemType string,
) {
	t.Helper()
	if err != nil || outcome.Problem == nil ||
		outcome.Problem.Type != problemType {
		t.Fatalf("outcome = %+v, err = %v", outcome, err)
	}
}

func assertCounts(
	t *testing.T, pool *pgxpool.Pool, commands, audits, events int,
) {
	t.Helper()
	ctx := context.Background()
	for table, want := range map[string]int{
		"global_command_ledger": commands,
		"global_audit_events":   audits,
		"global_outbox_events":  events,
	} {
		var got int
		err := pool.QueryRow(
			ctx, "SELECT count(*) FROM vetchium."+table,
		).Scan(&got)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("%s count = %d, want %d", table, got, want)
		}
	}
}

func TestPrincipalResponse(t *testing.T) {
	t.Parallel()
	did, err := dbvalue.ParseUUID(
		"018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
	)
	if err != nil {
		t.Fatal(err)
	}
	response := principalResponse(
		did, "abcde000-0123456789a", dbvalue.Text("mary-jane"),
		"ind1", 2, "active",
	)
	if response.ProfileAlias == nil || *response.ProfileAlias != "mary-jane" ||
		response.RoutingVersion != 2 {
		t.Fatalf("response = %+v", response)
	}
}
