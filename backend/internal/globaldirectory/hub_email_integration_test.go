package globaldirectory

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
)

const testDigestKeyID = "909577e87ebd5395"

func newHubEmailTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("GLOBAL_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("GLOBAL_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	resetHubEmailTables(t, pool)
	t.Cleanup(func() { resetHubEmailTables(t, pool) })
	return pool
}

func resetHubEmailTables(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `TRUNCATE
        vetchium.global_outbox_events,
        vetchium.global_command_ledger,
        vetchium.global_audit_events,
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

// digestFor returns a deterministic, collision-resistant fake 64-hex-character
// digest for test readability; the tests never decode it back to an address.
func digestFor(label string) directoryspec.EmailDigest {
	sum := sha256.Sum256([]byte(label))
	return directoryspec.EmailDigest(hex.EncodeToString(sum[:]))
}

// uuidFor derives a UUIDv7-shaped (hub.IsHubUserDID-valid) identifier from a
// label, distinct from digestFor's own hash space (different domain prefix)
// so a DID and a digest built from related labels never collide.
func uuidFor(label string) string {
	sum := sha256.Sum256([]byte("uuid\x00" + label))
	hexDigest := hex.EncodeToString(sum[:])
	return fmt.Sprintf(
		"%s-%s-7%s-8%s-%s",
		hexDigest[0:8], hexDigest[8:12], hexDigest[13:16], hexDigest[17:20],
		hexDigest[20:32],
	)
}

const handleSuffixAlphabet = "0123456789abcdefghjkmnpqrstvwxyz"

// handleFor derives a permanent-handle-shaped (hub.IsHubHandle-valid) string
// from a label: an 8-character lowercase-alphanumeric prefix and an
// 11-character Crockford-base32 suffix (excluding i, l, o, u).
func handleFor(label string) string {
	sum := sha256.Sum256([]byte("handle\x00" + label))
	prefix := make([]byte, 8)
	for i := range prefix {
		prefix[i] = "0123456789abcdefghijklmnopqrstuvwxyz"[int(sum[i])%36]
	}
	suffix := make([]byte, 11)
	for i := range suffix {
		suffix[i] = handleSuffixAlphabet[int(sum[8+i])%len(handleSuffixAlphabet)]
	}
	return string(prefix) + "-" + string(suffix)
}

// activateTestPrincipal reserves and activates a Hub principal with a fresh
// account-email claim, for tests that need an active principal to operate
// against (email-change commands require one).
func activateTestPrincipal(
	t *testing.T, service *Service, tenant directoryspec.TenantID,
	label string,
) hub.HubUserDID {
	t.Helper()
	ctx := context.Background()
	did := hub.HubUserDID(uuidFor("did-" + label))
	handle := hub.HubHandle(handleFor(label))
	reserve := directoryspec.ReserveHubPrincipalRequest{
		CommandID:  directoryspec.CommandID(uuidFor("reserve-" + label)),
		HubUserDID: did, Handle: handle, HomeTenantID: tenant,
		ProvisioningExpiresAt: time.Now().UTC().Add(time.Hour),
		AccountEmailDigest:    digestFor("account-" + label),
		DigestKeyID:           testDigestKeyID,
	}
	outcome, err := service.ReserveHubPrincipal(ctx, tenant, reserve)
	if err != nil || outcome.Problem != nil {
		t.Fatalf("reserve principal %s: outcome=%+v err=%v", label, outcome, err)
	}
	activate := directoryspec.ActivateHubPrincipalRequest{
		CommandID:  directoryspec.CommandID(uuidFor("activate-" + label)),
		HubUserDID: did,
	}
	activated, err := service.ActivateHubPrincipal(ctx, tenant, activate)
	if err != nil || activated.Problem != nil {
		t.Fatalf("activate principal %s: outcome=%+v err=%v", label, activated, err)
	}
	return did
}

func TestResolveHubAccountEmail(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	did := activateTestPrincipal(t, service, "sgp", "resolve")

	response, problemDetails, err := service.ResolveHubAccountEmail(
		ctx, directoryspec.ResolveHubAccountEmailRequest{
			EmailDigest: digestFor("account-resolve"), DigestKeyID: testDigestKeyID,
		},
	)
	if err != nil || problemDetails != nil || response.HomeTenantID != "sgp" {
		t.Fatalf("response=%+v problem=%+v err=%v", response, problemDetails, err)
	}
	_ = did

	_, _, err = service.ResolveHubAccountEmail(
		ctx, directoryspec.ResolveHubAccountEmailRequest{
			EmailDigest: digestFor("account-unknown"), DigestKeyID: testDigestKeyID,
		},
	)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown digest resolved: %v", err)
	}

	_, mismatch, err := service.ResolveHubAccountEmail(
		ctx, directoryspec.ResolveHubAccountEmailRequest{
			EmailDigest: digestFor("account-resolve"), DigestKeyID: "0000000000000000",
		},
	)
	if err != nil || mismatch == nil ||
		mismatch.Type != coordinatorproblem.DirectoryDigestKeyMismatchError.Type {
		t.Fatalf("digest key mismatch not rejected: problem=%+v err=%v", mismatch, err)
	}
}

func TestReserveHubPrincipalEmailConflictDistinctFromHandleConflict(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	activateTestPrincipal(t, service, "sgp", "owner")

	// Same email digest, different handle: must fail on the email claim,
	// not the handle, and must never reach the handle table.
	sameEmail := directoryspec.ReserveHubPrincipalRequest{
		CommandID:             directoryspec.CommandID(uuidFor("reserve-conflict-email")),
		HubUserDID:            hub.HubUserDID(uuidFor("did-conflict-email")),
		Handle:                hub.HubHandle("zzzzzzzz-0123456789z"),
		HomeTenantID:          "sgp",
		ProvisioningExpiresAt: time.Now().UTC().Add(time.Hour),
		AccountEmailDigest:    digestFor("account-owner"),
		DigestKeyID:           testDigestKeyID,
	}
	outcome, err := service.ReserveHubPrincipal(ctx, "sgp", sameEmail)
	if err != nil || outcome.Problem == nil ||
		outcome.Problem.Type != coordinatorproblem.DirectoryEmailClaimConflictError.Type {
		t.Fatalf("email conflict not detected: outcome=%+v err=%v", outcome, err)
	}
	var handleCount int
	if err := pool.QueryRow(ctx,
		"SELECT count(*) FROM vetchium.hub_profile_slugs WHERE slug = $1",
		string(sameEmail.Handle),
	).Scan(&handleCount); err != nil {
		t.Fatal(err)
	}
	if handleCount != 0 {
		t.Fatalf("handle was inserted despite the email conflict: count=%d", handleCount)
	}

	// Same handle, different email: a normal handle collision, distinct
	// problem type.
	victimHandle := hub.HubHandle(handleFor("handle-victim"))
	victim := directoryspec.ReserveHubPrincipalRequest{
		CommandID:             directoryspec.CommandID(uuidFor("reserve-handle-victim")),
		HubUserDID:            hub.HubUserDID(uuidFor("did-handle-victim")),
		Handle:                victimHandle,
		HomeTenantID:          "sgp",
		ProvisioningExpiresAt: time.Now().UTC().Add(time.Hour),
		AccountEmailDigest:    digestFor("account-handle-victim"),
		DigestKeyID:           testDigestKeyID,
	}
	if outcome, err := service.ReserveHubPrincipal(ctx, "sgp", victim); err != nil || outcome.Problem != nil {
		t.Fatalf("reserve handle victim: outcome=%+v err=%v", outcome, err)
	}
	sameHandle := directoryspec.ReserveHubPrincipalRequest{
		CommandID:             directoryspec.CommandID(uuidFor("reserve-conflict-handle")),
		HubUserDID:            hub.HubUserDID(uuidFor("did-conflict-handle")),
		Handle:                victimHandle,
		HomeTenantID:          "sgp",
		ProvisioningExpiresAt: time.Now().UTC().Add(time.Hour),
		AccountEmailDigest:    digestFor("account-conflict-handle"),
		DigestKeyID:           testDigestKeyID,
	}
	handleOutcome, err := service.ReserveHubPrincipal(ctx, "sgp", sameHandle)
	if err != nil || handleOutcome.Problem == nil ||
		handleOutcome.Problem.Type != coordinatorproblem.DirectoryClaimConflictError.Type {
		t.Fatalf("handle conflict not detected: outcome=%+v err=%v", handleOutcome, err)
	}
}

func TestHubAccountEmailChangeLifecycle(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	did := activateTestPrincipal(t, service, "sgp", "change")
	notAfter := time.Now().UTC().Add(time.Hour)

	reserveReq := directoryspec.ReserveHubAccountEmailChangeRequest{
		CommandID:  directoryspec.CommandID(uuidFor("reserve-change-cmd")),
		ChangeID:   directoryspec.CommandID(uuidFor("change-id-1")),
		HubUserDID: did, NewEmailDigest: digestFor("new-address"),
		NotAfter: notAfter, DigestKeyID: testDigestKeyID,
	}
	reserved, err := service.ReserveHubAccountEmailChange(ctx, "sgp", reserveReq)
	if err != nil || reserved.Problem != nil ||
		reserved.Reservation.State != directoryspec.EmailChangeReserved {
		t.Fatalf("reserve failed: outcome=%+v err=%v", reserved, err)
	}

	// Idempotent replay with the identical command id and payload.
	replay, err := service.ReserveHubAccountEmailChange(ctx, "sgp", reserveReq)
	if err != nil || replay.Problem != nil ||
		replay.Reservation.State != directoryspec.EmailChangeReserved {
		t.Fatalf("replay failed: outcome=%+v err=%v", replay, err)
	}

	// A second reservation for a different address (new change id) replaces
	// the first: the stale reservation and its claim are cleaned up.
	secondChange := directoryspec.ReserveHubAccountEmailChangeRequest{
		CommandID:  directoryspec.CommandID(uuidFor("reserve-change-cmd-2")),
		ChangeID:   directoryspec.CommandID(uuidFor("change-id-2")),
		HubUserDID: did, NewEmailDigest: digestFor("another-address"),
		NotAfter: notAfter, DigestKeyID: testDigestKeyID,
	}
	secondOutcome, err := service.ReserveHubAccountEmailChange(ctx, "sgp", secondChange)
	if err != nil || secondOutcome.Problem != nil {
		t.Fatalf("second reserve failed: outcome=%+v err=%v", secondOutcome, err)
	}
	var pendingCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM vetchium.hub_account_email_claims
         WHERE hub_user_did = $1 AND state = 'pending_change'`,
		string(did),
	).Scan(&pendingCount); err != nil {
		t.Fatal(err)
	}
	if pendingCount != 1 {
		t.Fatalf("pending_change claim count = %d, want 1", pendingCount)
	}

	// The digest is already claimed by the same user's own current claim:
	// this is a fresh change id but a colliding claim, so it must conflict.
	collideWithOwnCurrent := directoryspec.ReserveHubAccountEmailChangeRequest{
		CommandID:  directoryspec.CommandID(uuidFor("reserve-change-cmd-3")),
		ChangeID:   directoryspec.CommandID(uuidFor("change-id-3")),
		HubUserDID: did, NewEmailDigest: digestFor("account-change"),
		NotAfter: notAfter, DigestKeyID: testDigestKeyID,
	}
	collideOutcome, err := service.ReserveHubAccountEmailChange(ctx, "sgp", collideWithOwnCurrent)
	if err != nil || collideOutcome.Problem == nil ||
		collideOutcome.Problem.Type != coordinatorproblem.DirectoryEmailClaimConflictError.Type {
		t.Fatalf("collision with own current claim not rejected: outcome=%+v err=%v", collideOutcome, err)
	}

	// Finalize the live (second) reservation.
	finalizeReq := directoryspec.FinalizeHubAccountEmailChangeRequest{
		CommandID: directoryspec.CommandID(uuidFor("finalize-cmd")),
		ChangeID:  secondChange.ChangeID, HubUserDID: did,
	}
	finalized, err := service.FinalizeHubAccountEmailChange(ctx, "sgp", finalizeReq)
	if err != nil || finalized.Problem != nil ||
		finalized.Reservation.State != directoryspec.EmailChangeFinalized {
		t.Fatalf("finalize failed: outcome=%+v err=%v", finalized, err)
	}
	// Replaying finalize succeeds without change.
	finalizedAgain, err := service.FinalizeHubAccountEmailChange(
		ctx, "sgp", directoryspec.FinalizeHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("finalize-cmd-2")),
			ChangeID:  secondChange.ChangeID, HubUserDID: did,
		},
	)
	if err != nil || finalizedAgain.Problem != nil ||
		finalizedAgain.Reservation.State != directoryspec.EmailChangeFinalized {
		t.Fatalf("finalize replay failed: outcome=%+v err=%v", finalizedAgain, err)
	}
	var activeDigest []byte
	if err := pool.QueryRow(ctx,
		`SELECT email_digest FROM vetchium.hub_account_email_claims
         WHERE hub_user_did = $1 AND state = 'active'`, string(did),
	).Scan(&activeDigest); err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(activeDigest) != string(secondChange.NewEmailDigest) {
		t.Fatalf("active digest = %x, want %s", activeDigest, secondChange.NewEmailDigest)
	}

	// Abandon after finalize is a state conflict.
	abandonAfterFinalize, err := service.AbandonHubAccountEmailChange(
		ctx, "sgp", directoryspec.AbandonHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("abandon-after-finalize")),
			ChangeID:  secondChange.ChangeID, HubUserDID: did, NotAfter: notAfter,
		},
	)
	if err != nil || abandonAfterFinalize.Problem == nil ||
		abandonAfterFinalize.Problem.Type != coordinatorproblem.DirectoryStateConflictError.Type {
		t.Fatalf("abandon after finalize not rejected: outcome=%+v err=%v", abandonAfterFinalize, err)
	}
}

func TestHubAccountEmailChangeFencing(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	did := activateTestPrincipal(t, service, "sgp", "fence")
	notAfter := time.Now().UTC().Add(time.Hour)
	changeID := directoryspec.CommandID(uuidFor("fence-change"))

	// Abandon before reserve: leaves a tombstone with a null digest.
	abandoned, err := service.AbandonHubAccountEmailChange(
		ctx, "sgp", directoryspec.AbandonHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("fence-abandon")),
			ChangeID:  changeID, HubUserDID: did, NotAfter: notAfter,
		},
	)
	if err != nil || abandoned.Problem != nil ||
		abandoned.Reservation.State != directoryspec.EmailChangeCancelled {
		t.Fatalf("abandon-before-reserve failed: outcome=%+v err=%v", abandoned, err)
	}
	var storedDigest []byte
	var digestValid bool
	if err := pool.QueryRow(ctx,
		`SELECT email_digest, email_digest IS NOT NULL
         FROM vetchium.hub_account_email_change_reservations WHERE change_id = $1`,
		string(changeID),
	).Scan(&storedDigest, &digestValid); err != nil {
		t.Fatal(err)
	}
	if digestValid {
		t.Fatalf("tombstone has a non-null digest: %x", storedDigest)
	}

	// The later reserve for the same change id is rejected as cancelled.
	lateReserve, err := service.ReserveHubAccountEmailChange(
		ctx, "sgp", directoryspec.ReserveHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("fence-reserve")),
			ChangeID:  changeID, HubUserDID: did,
			NewEmailDigest: digestFor("fence-address"),
			NotAfter:       notAfter, DigestKeyID: testDigestKeyID,
		},
	)
	if err != nil || lateReserve.Problem == nil ||
		lateReserve.Problem.Type != coordinatorproblem.DirectoryReservationCancelledError.Type {
		t.Fatalf("late reserve not fenced: outcome=%+v err=%v", lateReserve, err)
	}

	// Reserve after the deadline is expired, even for a fresh change id.
	expiredChangeID := directoryspec.CommandID(uuidFor("fence-expired"))
	past := time.Now().UTC().Add(-time.Minute)
	expired, err := service.ReserveHubAccountEmailChange(
		ctx, "sgp", directoryspec.ReserveHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("fence-reserve-expired")),
			ChangeID:  expiredChangeID, HubUserDID: did,
			NewEmailDigest: digestFor("fence-address-2"),
			NotAfter:       past, DigestKeyID: testDigestKeyID,
		},
	)
	if err != nil || expired.Problem == nil ||
		expired.Problem.Type != coordinatorproblem.DirectoryReservationExpiredError.Type {
		t.Fatalf("expired reserve not rejected: outcome=%+v err=%v", expired, err)
	}
}

func TestHubAccountEmailChangeDigestKeyMismatch(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	did := activateTestPrincipal(t, service, "sgp", "keymismatch")

	outcome, err := service.ReserveHubAccountEmailChange(
		ctx, "sgp", directoryspec.ReserveHubAccountEmailChangeRequest{
			CommandID:  directoryspec.CommandID(uuidFor("keymismatch-cmd")),
			ChangeID:   directoryspec.CommandID(uuidFor("keymismatch-change")),
			HubUserDID: did, NewEmailDigest: digestFor("keymismatch-address"),
			NotAfter: time.Now().UTC().Add(time.Hour), DigestKeyID: "0000000000000000",
		},
	)
	if err != nil || outcome.Problem == nil ||
		outcome.Problem.Type != coordinatorproblem.DirectoryDigestKeyMismatchError.Type {
		t.Fatalf("digest key mismatch not rejected: outcome=%+v err=%v", outcome, err)
	}
}

func TestHubAccountEmailChangeCallerTenantMismatch(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	did := activateTestPrincipal(t, service, "sgp", "tenantmismatch")

	outcome, err := service.ReserveHubAccountEmailChange(
		ctx, "usa1", directoryspec.ReserveHubAccountEmailChangeRequest{
			CommandID:  directoryspec.CommandID(uuidFor("tenantmismatch-cmd")),
			ChangeID:   directoryspec.CommandID(uuidFor("tenantmismatch-change")),
			HubUserDID: did, NewEmailDigest: digestFor("tenantmismatch-address"),
			NotAfter: time.Now().UTC().Add(time.Hour), DigestKeyID: testDigestKeyID,
		},
	)
	if err != nil || outcome.Problem == nil ||
		outcome.Problem.Type != coordinatorproblem.DirectoryCallerTenantMismatchError.Type {
		t.Fatalf("caller tenant mismatch not rejected: outcome=%+v err=%v", outcome, err)
	}
}

func TestPruneTerminalHubAccountEmailChangeReservations(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	did := activateTestPrincipal(t, service, "sgp", "prune")

	recent := directoryspec.CommandID(uuidFor("prune-recent"))
	old := directoryspec.CommandID(uuidFor("prune-old"))
	if _, err := service.AbandonHubAccountEmailChange(
		ctx, "sgp", directoryspec.AbandonHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("prune-recent-cmd")),
			ChangeID:  recent, HubUserDID: did,
			NotAfter: time.Now().UTC().Add(time.Hour),
		},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.AbandonHubAccountEmailChange(
		ctx, "sgp", directoryspec.AbandonHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("prune-old-cmd")),
			ChangeID:  old, HubUserDID: did,
			NotAfter: time.Now().UTC().Add(-8 * 24 * time.Hour),
		},
	); err != nil {
		t.Fatal(err)
	}

	pruned, err := service.PruneTerminalHubAccountEmailChangeReservations(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if pruned != 1 {
		t.Fatalf("pruned = %d, want 1", pruned)
	}
	var remaining int
	if err := pool.QueryRow(ctx,
		"SELECT count(*) FROM vetchium.hub_account_email_change_reservations",
	).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 1 {
		t.Fatalf("remaining reservations = %d, want 1 (the recent one)", remaining)
	}
	var auditTenant, prunedCount string
	if err := pool.QueryRow(ctx, `SELECT actor_tenant_id, payload ->> 'pruned_count'
        FROM vetchium.global_audit_events
        WHERE action = 'global_directory.hub_account_email_change_reservations_pruned'`,
	).Scan(&auditTenant, &prunedCount); err != nil {
		t.Fatal(err)
	}
	if auditTenant != "sgp" || prunedCount != "1" {
		t.Fatalf("prune audit = %s/%s, want sgp/1", auditTenant, prunedCount)
	}

	// An idle prune writes no audit event.
	if pruned, err := service.PruneTerminalHubAccountEmailChangeReservations(ctx); err != nil || pruned != 0 {
		t.Fatalf("idle prune = %d, %v", pruned, err)
	}
	var audits int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vetchium.global_audit_events
        WHERE action = 'global_directory.hub_account_email_change_reservations_pruned'`,
	).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("prune audit events = %d, %v", audits, err)
	}
}

// A change id names a reservation but proves nothing about its owner: the
// caller's own principal must own the reservation it finalizes, abandons, or
// replays.
func TestHubAccountEmailChangeRejectsAnotherUsersReservation(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	victim := activateTestPrincipal(t, service, "sgp", "owner-victim")
	attacker := activateTestPrincipal(t, service, "sgp", "owner-attacker")
	notAfter := time.Now().UTC().Add(time.Hour)
	changeID := directoryspec.CommandID(uuidFor("owner-victim-change"))
	reserve := directoryspec.ReserveHubAccountEmailChangeRequest{
		CommandID: directoryspec.CommandID(uuidFor("owner-victim-reserve")),
		ChangeID:  changeID, HubUserDID: victim,
		NewEmailDigest: digestFor("owner-victim-new"),
		NotAfter:       notAfter, DigestKeyID: testDigestKeyID,
	}
	if outcome, err := service.ReserveHubAccountEmailChange(ctx, "sgp", reserve); err != nil || outcome.Problem != nil {
		t.Fatalf("victim reserve: outcome=%+v err=%v", outcome, err)
	}

	assertStateConflict := func(name string, outcome EmailChangeOutcome, err error) {
		t.Helper()
		if err != nil || outcome.Problem == nil ||
			outcome.Problem.Type != coordinatorproblem.DirectoryStateConflictError.Type {
			t.Fatalf("%s: outcome=%+v err=%v", name, outcome, err)
		}
	}
	abandoned, err := service.AbandonHubAccountEmailChange(
		ctx, "sgp", directoryspec.AbandonHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("owner-attacker-abandon")),
			ChangeID:  changeID, HubUserDID: attacker, NotAfter: notAfter,
		},
	)
	assertStateConflict("abandon", abandoned, err)
	finalized, err := service.FinalizeHubAccountEmailChange(
		ctx, "sgp", directoryspec.FinalizeHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("owner-attacker-finalize")),
			ChangeID:  changeID, HubUserDID: attacker,
		},
	)
	assertStateConflict("finalize", finalized, err)
	replayed, err := service.ReserveHubAccountEmailChange(
		ctx, "sgp", directoryspec.ReserveHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("owner-attacker-reserve")),
			ChangeID:  changeID, HubUserDID: attacker,
			NewEmailDigest: reserve.NewEmailDigest,
			NotAfter:       notAfter, DigestKeyID: testDigestKeyID,
		},
	)
	assertStateConflict("reserve", replayed, err)

	var reservationState, attackerDigest string
	if err := pool.QueryRow(ctx, `SELECT reservation.state::text,
            encode(claim.email_digest, 'hex')
        FROM vetchium.hub_account_email_change_reservations AS reservation
        CROSS JOIN vetchium.hub_account_email_claims AS claim
        WHERE reservation.change_id = $1
          AND claim.hub_user_did = $2 AND claim.state = 'active'`,
		string(changeID), string(attacker),
	).Scan(&reservationState, &attackerDigest); err != nil {
		t.Fatal(err)
	}
	if reservationState != "reserved" ||
		attackerDigest != string(digestFor("account-owner-attacker")) {
		t.Fatalf("reservation = %s, attacker digest = %s", reservationState, attackerDigest)
	}
}

// Every email-change command writes its ledger row, one audit event naming
// each reservation it changed, and a versioned outbox event per transition in
// one transaction (PROF-XTN-002), including the stale reservation a newer
// reserve cancels. No record carries a digest, and a replay adds none.
func TestHubAccountEmailChangeChangeRecords(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	did := activateTestPrincipal(t, service, "sgp", "outbox")
	notAfter := time.Now().UTC().Add(time.Hour)
	stale := directoryspec.CommandID(uuidFor("outbox-stale"))
	live := directoryspec.CommandID(uuidFor("outbox-live"))
	fenced := directoryspec.CommandID(uuidFor("outbox-fenced"))
	for _, change := range []directoryspec.CommandID{stale, live} {
		if outcome, err := service.ReserveHubAccountEmailChange(
			ctx, "sgp", directoryspec.ReserveHubAccountEmailChangeRequest{
				CommandID: directoryspec.CommandID(uuidFor("reserve-" + string(change))),
				ChangeID:  change, HubUserDID: did,
				NewEmailDigest: digestFor("address-" + string(change)),
				NotAfter:       notAfter, DigestKeyID: testDigestKeyID,
			},
		); err != nil || outcome.Problem != nil {
			t.Fatalf("reserve %s: outcome=%+v err=%v", change, outcome, err)
		}
	}
	if outcome, err := service.FinalizeHubAccountEmailChange(
		ctx, "sgp", directoryspec.FinalizeHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("outbox-finalize")),
			ChangeID:  live, HubUserDID: did,
		},
	); err != nil || outcome.Problem != nil {
		t.Fatalf("finalize: outcome=%+v err=%v", outcome, err)
	}
	if outcome, err := service.AbandonHubAccountEmailChange(
		ctx, "sgp", directoryspec.AbandonHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("outbox-abandon")),
			ChangeID:  fenced, HubUserDID: did, NotAfter: notAfter,
		},
	); err != nil || outcome.Problem != nil {
		t.Fatalf("abandon: outcome=%+v err=%v", outcome, err)
	}

	rows, err := pool.Query(ctx, `SELECT aggregate_id || '|' ||
            aggregate_version || '|' || event_type || '|' ||
            (payload ->> 'state') || '|' || (payload ->> 'hub_user_did'),
            payload::text
        FROM vetchium.global_outbox_events
        WHERE aggregate_type = 'hub_account_email_change_reservation'
        ORDER BY aggregate_id, aggregate_version`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string]bool{}
	for rows.Next() {
		var summary, payload string
		if err := rows.Scan(&summary, &payload); err != nil {
			t.Fatal(err)
		}
		for _, change := range []directoryspec.CommandID{stale, live, fenced} {
			digest := string(digestFor("address-" + string(change)))
			if strings.Contains(payload, digest) {
				t.Fatalf("outbox payload carries a digest: %s", payload)
			}
		}
		got[summary] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	want := []string{
		string(stale) + "|1|hub_account_email_change_reserved.v1|reserved|" + string(did),
		string(stale) + "|2|hub_account_email_change_cancelled.v1|cancelled|" + string(did),
		string(live) + "|1|hub_account_email_change_reserved.v1|reserved|" + string(did),
		string(live) + "|2|hub_account_email_change_finalized.v1|finalized|" + string(did),
		string(fenced) + "|1|hub_account_email_change_cancelled.v1|cancelled|" + string(did),
	}
	if len(got) != len(want) {
		t.Fatalf("outbox events = %v, want %v", got, want)
	}
	for _, event := range want {
		if !got[event] {
			t.Fatalf("missing outbox event %s in %v", event, got)
		}
	}

	type auditRecord struct {
		action, changeID, state, cancelled, entity, actor, commandID string
	}
	auditRows, err := pool.Query(ctx, `SELECT action,
            payload ->> 'change_id', payload ->> 'state',
            (payload -> 'cancelled_change_ids')::text,
            entity_type || '/' || entity_id, actor_tenant_id,
            command_id::text, payload::text
        FROM vetchium.global_audit_events
        WHERE action LIKE 'global_directory.hub_account_email_change%'`)
	if err != nil {
		t.Fatal(err)
	}
	defer auditRows.Close()
	audits := map[string]auditRecord{}
	for auditRows.Next() {
		var record auditRecord
		var payload string
		if err := auditRows.Scan(
			&record.action, &record.changeID, &record.state, &record.cancelled,
			&record.entity, &record.actor, &record.commandID, &payload,
		); err != nil {
			t.Fatal(err)
		}
		for _, change := range []directoryspec.CommandID{stale, live, fenced} {
			if strings.Contains(payload, string(digestFor("address-"+string(change)))) {
				t.Fatalf("audit payload carries a digest: %s", payload)
			}
		}
		audits[record.commandID] = record
	}
	if err := auditRows.Err(); err != nil {
		t.Fatal(err)
	}
	entity := "hub_account_email_claim/" + string(did)
	record := func(
		action, commandLabel string, change directoryspec.CommandID,
		state, cancelled string,
	) auditRecord {
		return auditRecord{
			action: "global_directory." + action, changeID: string(change),
			state: state, cancelled: cancelled, entity: entity, actor: "sgp",
			commandID: uuidFor(commandLabel),
		}
	}
	wantAudits := []auditRecord{
		record("hub_account_email_change_reserved", "reserve-"+string(stale),
			stale, "reserved", "[]"),
		record("hub_account_email_change_reserved", "reserve-"+string(live),
			live, "reserved", `["`+string(stale)+`"]`),
		record("hub_account_email_changed", "outbox-finalize",
			live, "finalized", "[]"),
		record("hub_account_email_change_abandoned", "outbox-abandon",
			fenced, "cancelled", "[]"),
	}
	// The LIKE above also matches hub_account_email_changed.
	if len(audits) != len(wantAudits) {
		t.Fatalf("audit events = %+v, want %+v", audits, wantAudits)
	}
	for _, want := range wantAudits {
		if audits[want.commandID] != want {
			t.Fatalf("audit = %+v, want %+v", audits[want.commandID], want)
		}
	}

	var ledger int
	if err := pool.QueryRow(ctx, `SELECT count(*)
        FROM vetchium.global_command_ledger
        WHERE command_id = ANY($1::uuid[]) AND response_status = 200`,
		[]string{
			uuidFor("reserve-" + string(stale)), uuidFor("reserve-" + string(live)),
			uuidFor("outbox-finalize"), uuidFor("outbox-abandon"),
		},
	).Scan(&ledger); err != nil || ledger != 4 {
		t.Fatalf("ledger rows = %d, %v", ledger, err)
	}

	// Replaying a stored command returns its result and writes nothing new.
	counts := func() string {
		t.Helper()
		var total string
		if err := pool.QueryRow(ctx, `SELECT
                (SELECT count(*) FROM vetchium.global_command_ledger) || '/' ||
                (SELECT count(*) FROM vetchium.global_audit_events) || '/' ||
                (SELECT count(*) FROM vetchium.global_outbox_events)`,
		).Scan(&total); err != nil {
			t.Fatal(err)
		}
		return total
	}
	before := counts()
	if outcome, err := service.FinalizeHubAccountEmailChange(
		ctx, "sgp", directoryspec.FinalizeHubAccountEmailChangeRequest{
			CommandID: directoryspec.CommandID(uuidFor("outbox-finalize")),
			ChangeID:  live, HubUserDID: did,
		},
	); err != nil || outcome.Problem != nil {
		t.Fatalf("finalize replay: outcome=%+v err=%v", outcome, err)
	}
	if after := counts(); after != before {
		t.Fatalf("replay wrote records: ledger/audit/outbox %s -> %s", before, after)
	}
}

// A failed audit insert rolls back the whole command: the new reservation,
// its claim, the stale cancellation, the outbox events, and the ledger row.
// The identical command then succeeds once the audit can be written.
func TestHubAccountEmailChangeAuditFailureRollsBack(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	did := activateTestPrincipal(t, service, "sgp", "audit-failure")
	notAfter := time.Now().UTC().Add(time.Hour)
	stale := directoryspec.ReserveHubAccountEmailChangeRequest{
		CommandID:  directoryspec.CommandID(uuidFor("audit-failure-stale-cmd")),
		ChangeID:   directoryspec.CommandID(uuidFor("audit-failure-stale")),
		HubUserDID: did, NewEmailDigest: digestFor("audit-failure-stale"),
		NotAfter: notAfter, DigestKeyID: testDigestKeyID,
	}
	if outcome, err := service.ReserveHubAccountEmailChange(ctx, "sgp", stale); err != nil || outcome.Problem != nil {
		t.Fatalf("stale reserve: outcome=%+v err=%v", outcome, err)
	}

	// The trigger lives only in this test's disposable database.
	if _, err := pool.Exec(ctx, `
        CREATE FUNCTION vetchium.test_reject_email_change_audit()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'injected audit failure';
        END;
        $$;
        CREATE TRIGGER test_reject_email_change_audit
        BEFORE INSERT ON vetchium.global_audit_events
        FOR EACH ROW
        WHEN (NEW.action = 'global_directory.hub_account_email_change_reserved')
        EXECUTE FUNCTION vetchium.test_reject_email_change_audit();`,
	); err != nil {
		t.Fatal(err)
	}
	dropTrigger := func() {
		if _, err := pool.Exec(ctx, `
            DROP TRIGGER IF EXISTS test_reject_email_change_audit
                ON vetchium.global_audit_events;
            DROP FUNCTION IF EXISTS vetchium.test_reject_email_change_audit();`,
		); err != nil {
			t.Error(err)
		}
	}
	t.Cleanup(dropTrigger)

	replacement := directoryspec.ReserveHubAccountEmailChangeRequest{
		CommandID:  directoryspec.CommandID(uuidFor("audit-failure-cmd")),
		ChangeID:   directoryspec.CommandID(uuidFor("audit-failure-change")),
		HubUserDID: did, NewEmailDigest: digestFor("audit-failure-new"),
		NotAfter: notAfter, DigestKeyID: testDigestKeyID,
	}
	if _, err := service.ReserveHubAccountEmailChange(ctx, "sgp", replacement); err == nil {
		t.Fatal("reserve succeeded despite the audit failure")
	}
	var reservations, pendingDigest, ledger, events string
	if err := pool.QueryRow(ctx, `SELECT
            (SELECT string_agg(change_id::text || ':' || state::text, ',')
             FROM vetchium.hub_account_email_change_reservations),
            (SELECT encode(email_digest, 'hex')
             FROM vetchium.hub_account_email_claims
             WHERE hub_user_did = $1 AND state = 'pending_change'),
            (SELECT count(*)::text FROM vetchium.global_command_ledger
             WHERE command_id = $2),
            (SELECT count(*)::text FROM vetchium.global_outbox_events
             WHERE aggregate_id = $3)`,
		string(did), string(replacement.CommandID), string(replacement.ChangeID),
	).Scan(&reservations, &pendingDigest, &ledger, &events); err != nil {
		t.Fatal(err)
	}
	if reservations != string(stale.ChangeID)+":reserved" ||
		pendingDigest != string(stale.NewEmailDigest) ||
		ledger != "0" || events != "0" {
		t.Fatalf("after failed audit: reservations=%s pending=%s ledger=%s outbox=%s",
			reservations, pendingDigest, ledger, events)
	}

	dropTrigger()
	outcome, err := service.ReserveHubAccountEmailChange(ctx, "sgp", replacement)
	if err != nil || outcome.Problem != nil ||
		outcome.Reservation.State != directoryspec.EmailChangeReserved {
		t.Fatalf("retry: outcome=%+v err=%v", outcome, err)
	}
}

// GU-DIR-010: reaping an expired provisioning principal releases its account
// email claim and audits that release in the same statement.
func TestReapExpiredHubPrincipalReleasesEmailClaim(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	did := hub.HubUserDID(uuidFor("did-reap"))
	reserve := directoryspec.ReserveHubPrincipalRequest{
		CommandID:  directoryspec.CommandID(uuidFor("reserve-reap")),
		HubUserDID: did, Handle: hub.HubHandle(handleFor("reap")),
		HomeTenantID:          "usa1",
		ProvisioningExpiresAt: time.Now().UTC().Add(time.Hour),
		AccountEmailDigest:    digestFor("account-reap"),
		DigestKeyID:           testDigestKeyID,
	}
	if outcome, err := service.ReserveHubPrincipal(ctx, "usa1", reserve); err != nil || outcome.Problem != nil {
		t.Fatalf("reserve: outcome=%+v err=%v", outcome, err)
	}
	if reaped, err := service.ReapExpiredReservations(ctx); err != nil || reaped != 0 {
		t.Fatalf("reap before expiry = %d, %v", reaped, err)
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
	if _, err := tx.Exec(ctx, `UPDATE vetchium.hub_principals
        SET created_at = now() - interval '2 hours',
            updated_at = now() - interval '2 hours',
            provisioning_expires_at = now() - interval '1 hour'
        WHERE hub_user_did = $1`, string(did)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if reaped, err := service.ReapExpiredReservations(ctx); err != nil || reaped != 1 {
		t.Fatalf("reaped = %d, %v", reaped, err)
	}
	var claims int
	if err := pool.QueryRow(ctx, `SELECT count(*)
        FROM vetchium.hub_account_email_claims WHERE hub_user_did = $1`,
		string(did)).Scan(&claims); err != nil || claims != 0 {
		t.Fatalf("claims after reap = %d, %v", claims, err)
	}
	var audit string
	if err := pool.QueryRow(ctx, `SELECT actor_tenant_id || '|' ||
            (payload ->> 'email_claim_released') || '|' || command_id::text
        FROM vetchium.global_audit_events
        WHERE action = 'global_directory.hub_principal_reservation_expired'
          AND entity_id = $1`, string(did)).Scan(&audit); err != nil {
		t.Fatal(err)
	}
	if audit != "usa1|true|"+string(reserve.CommandID) {
		t.Fatalf("reap audit = %q", audit)
	}
	_, _, err = service.ResolveHubAccountEmail(
		ctx, directoryspec.ResolveHubAccountEmailRequest{
			EmailDigest: reserve.AccountEmailDigest, DigestKeyID: testDigestKeyID,
		},
	)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("reaped claim still resolves: %v", err)
	}
}
