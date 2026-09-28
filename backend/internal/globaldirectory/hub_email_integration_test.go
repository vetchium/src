package globaldirectory

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/dbvalue"
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

	pruned, err := service.queries.PruneTerminalHubAccountEmailChangeReservations(
		ctx, dbvalue.Timestamp(time.Now().UTC().Add(-7*24*time.Hour)),
	)
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
}
