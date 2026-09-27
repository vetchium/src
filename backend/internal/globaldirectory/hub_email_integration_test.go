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
// against (professional-email and email-change commands require one).
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

func TestClaimHubProfessionalEmailFirstReverifyAndTransfer(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	holderA := activateTestPrincipal(t, service, "sgp", "pem-a")
	holderB := activateTestPrincipal(t, service, "sgp", "pem-b")
	digest := digestFor("work-address")

	first, err := service.ClaimHubProfessionalEmail(
		ctx, "sgp", directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("pem-claim-1")),
			HubUserDID: holderA, EmailDigest: digest, DigestKeyID: testDigestKeyID,
		},
	)
	if err != nil || first.Problem != nil || first.Claim.ClaimRevision != 1 {
		t.Fatalf("first claim failed: outcome=%+v err=%v", first, err)
	}

	reverify, err := service.ClaimHubProfessionalEmail(
		ctx, "sgp", directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("pem-claim-reverify")),
			HubUserDID: holderA, EmailDigest: digest, DigestKeyID: testDigestKeyID,
		},
	)
	if err != nil || reverify.Problem != nil || reverify.Claim.ClaimRevision != 2 {
		t.Fatalf("reverify failed: outcome=%+v err=%v", reverify, err)
	}

	// Same-tenant transfer: B takes it from A, both homed at sgp, so the
	// response names A's DID for immediate local supersession.
	transfer, err := service.ClaimHubProfessionalEmail(
		ctx, "sgp", directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("pem-claim-transfer")),
			HubUserDID: holderB, EmailDigest: digest, DigestKeyID: testDigestKeyID,
		},
	)
	if err != nil || transfer.Problem != nil || transfer.Claim.ClaimRevision != 3 {
		t.Fatalf("transfer failed: outcome=%+v err=%v", transfer, err)
	}
	if transfer.Claim.SupersededSameTenantHubUserDID == nil ||
		*transfer.Claim.SupersededSameTenantHubUserDID != holderA {
		t.Fatalf("same-tenant supersession DID = %+v, want %s",
			transfer.Claim.SupersededSameTenantHubUserDID, holderA)
	}

	// Cross-tenant transfer writes a supersession row addressed to sgp
	// (holder B's tenant) and reveals no DID in the response, since usa1
	// (the caller here) is not sgp.
	holderC := activateTestPrincipal(t, service, "usa1", "pem-c")
	crossTransfer, err := service.ClaimHubProfessionalEmail(
		ctx, "usa1", directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("pem-claim-cross")),
			HubUserDID: holderC, EmailDigest: digest, DigestKeyID: testDigestKeyID,
		},
	)
	if err != nil || crossTransfer.Problem != nil || crossTransfer.Claim.ClaimRevision != 4 {
		t.Fatalf("cross-tenant transfer failed: outcome=%+v err=%v", crossTransfer, err)
	}
	if crossTransfer.Claim.SupersededSameTenantHubUserDID != nil {
		t.Fatalf("cross-tenant transfer revealed a foreign DID: %+v", crossTransfer.Claim)
	}
	var supersessionCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM vetchium.hub_professional_email_supersessions
         WHERE previous_home_tenant_id = 'sgp' AND previous_hub_user_did = $1
           AND superseded_by_revision = 4`, string(holderB),
	).Scan(&supersessionCount); err != nil {
		t.Fatal(err)
	}
	if supersessionCount != 1 {
		t.Fatalf("supersession row count = %d, want 1", supersessionCount)
	}
}

func TestReleaseHubProfessionalEmail(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	holder := activateTestPrincipal(t, service, "sgp", "release-holder")
	other := activateTestPrincipal(t, service, "sgp", "release-other")
	digest := digestFor("release-address")

	claimed, err := service.ClaimHubProfessionalEmail(
		ctx, "sgp", directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("release-claim")),
			HubUserDID: holder, EmailDigest: digest, DigestKeyID: testDigestKeyID,
		},
	)
	if err != nil || claimed.Problem != nil {
		t.Fatalf("claim failed: outcome=%+v err=%v", claimed, err)
	}

	// Stale revision is a no-op.
	stale, err := service.ReleaseHubProfessionalEmail(
		ctx, "sgp", directoryspec.ReleaseHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("release-stale")),
			HubUserDID: holder, EmailDigest: digest, ClaimRevision: 999,
		},
	)
	if err != nil || stale.Problem != nil || stale.Release.Released {
		t.Fatalf("stale release outcome=%+v err=%v", stale, err)
	}

	// Current revision clears the holder.
	released, err := service.ReleaseHubProfessionalEmail(
		ctx, "sgp", directoryspec.ReleaseHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("release-current")),
			HubUserDID: holder, EmailDigest: digest,
			ClaimRevision: claimed.Claim.ClaimRevision,
		},
	)
	if err != nil || released.Problem != nil || !released.Release.Released {
		t.Fatalf("release outcome=%+v err=%v", released, err)
	}

	// A reclaim after release gets a strictly higher revision than the
	// released claim.
	reclaimed, err := service.ClaimHubProfessionalEmail(
		ctx, "sgp", directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("release-reclaim")),
			HubUserDID: other, EmailDigest: digest, DigestKeyID: testDigestKeyID,
		},
	)
	if err != nil || reclaimed.Problem != nil ||
		reclaimed.Claim.ClaimRevision <= claimed.Claim.ClaimRevision {
		t.Fatalf("reclaim after release outcome=%+v err=%v", reclaimed, err)
	}
}

func TestCheckHubProfessionalEmailHoldings(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	holder := activateTestPrincipal(t, service, "sgp", "holdings-holder")
	requester := activateTestPrincipal(t, service, "sgp", "holdings-requester")
	heldDigest := digestFor("holdings-held")
	releasedDigest := digestFor("holdings-released")
	neverClaimedDigest := digestFor("holdings-never")

	if _, err := service.ClaimHubProfessionalEmail(
		ctx, "sgp", directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("holdings-claim-held")),
			HubUserDID: holder, EmailDigest: heldDigest, DigestKeyID: testDigestKeyID,
		},
	); err != nil {
		t.Fatal(err)
	}
	releasedClaim, err := service.ClaimHubProfessionalEmail(
		ctx, "sgp", directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("holdings-claim-released")),
			HubUserDID: holder, EmailDigest: releasedDigest, DigestKeyID: testDigestKeyID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReleaseHubProfessionalEmail(
		ctx, "sgp", directoryspec.ReleaseHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("holdings-release")),
			HubUserDID: holder, EmailDigest: releasedDigest,
			ClaimRevision: releasedClaim.Claim.ClaimRevision,
		},
	); err != nil {
		t.Fatal(err)
	}

	response, problemDetails, err := service.CheckHubProfessionalEmailHoldings(
		ctx, "sgp", directoryspec.CheckHubProfessionalEmailHoldingsRequest{
			Items: []directoryspec.HubProfessionalEmailHoldingQuery{
				{HubUserDID: holder, EmailDigest: heldDigest},
				{HubUserDID: requester, EmailDigest: heldDigest},
				{HubUserDID: holder, EmailDigest: releasedDigest},
				{HubUserDID: holder, EmailDigest: neverClaimedDigest},
			},
		},
	)
	if err != nil || problemDetails != nil || len(response.Results) != 4 {
		t.Fatalf("response=%+v problem=%+v err=%v", response, problemDetails, err)
	}
	if !response.Results[0].HeldByRequestedUser || response.Results[0].ClaimRevision == nil {
		t.Fatalf("held result = %+v, want held with a revision", response.Results[0])
	}
	if response.Results[1].HeldByRequestedUser {
		t.Fatalf("holdings check revealed a foreign holder: %+v", response.Results[1])
	}
	if response.Results[2].HeldByRequestedUser || response.Results[2].ClaimRevision != nil {
		t.Fatalf("released result = %+v, want unheld with no revision", response.Results[2])
	}
	if response.Results[3].HeldByRequestedUser || response.Results[3].ClaimRevision != nil {
		t.Fatalf("never-claimed result = %+v, want unheld with no revision", response.Results[3])
	}

	// A DID not homed at the caller rejects the whole batch.
	foreign := activateTestPrincipal(t, service, "usa1", "holdings-foreign")
	_, rejected, err := service.CheckHubProfessionalEmailHoldings(
		ctx, "sgp", directoryspec.CheckHubProfessionalEmailHoldingsRequest{
			Items: []directoryspec.HubProfessionalEmailHoldingQuery{
				{HubUserDID: foreign, EmailDigest: heldDigest},
			},
		},
	)
	if err != nil || rejected == nil ||
		rejected.Type != coordinatorproblem.DirectoryCallerTenantMismatchError.Type {
		t.Fatalf("foreign DID not rejected: problem=%+v err=%v", rejected, err)
	}
}

func TestPullHubProfessionalEmailSupersessionsAcknowledgment(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	holder := activateTestPrincipal(t, service, "sgp", "feed-holder")
	newHolder := activateTestPrincipal(t, service, "usa1", "feed-new-holder")
	digest := digestFor("feed-address")

	if _, err := service.ClaimHubProfessionalEmail(
		ctx, "sgp", directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("feed-claim")),
			HubUserDID: holder, EmailDigest: digest, DigestKeyID: testDigestKeyID,
		},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ClaimHubProfessionalEmail(
		ctx, "usa1", directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("feed-transfer")),
			HubUserDID: newHolder, EmailDigest: digest, DigestKeyID: testDigestKeyID,
		},
	); err != nil {
		t.Fatal(err)
	}

	// acknowledged_seq ahead of last_issued_seq is a conflict.
	_, conflict, err := service.PullHubProfessionalEmailSupersessions(
		ctx, "sgp", directoryspec.PullHubProfessionalEmailSupersessionsRequest{
			AcknowledgedSeq: 999, Limit: 10,
		},
	)
	if err != nil || conflict == nil ||
		conflict.Type != coordinatorproblem.DirectoryStateConflictError.Type {
		t.Fatalf("ack-ahead-of-issued not rejected: problem=%+v err=%v", conflict, err)
	}

	// First pull returns the pending row and advances the watermark.
	first, problemDetails, err := service.PullHubProfessionalEmailSupersessions(
		ctx, "sgp", directoryspec.PullHubProfessionalEmailSupersessionsRequest{
			AcknowledgedSeq: 0, Limit: 10,
		},
	)
	if err != nil || problemDetails != nil || len(first.Supersessions) != 1 ||
		first.Supersessions[0].HubUserDID != holder {
		t.Fatalf("first pull = %+v, problem=%+v, err=%v", first, problemDetails, err)
	}
	if first.AcknowledgedSeq != 0 {
		t.Fatalf("first pull acknowledged_seq = %d, want 0 (not yet acked)", first.AcknowledgedSeq)
	}
	var remaining int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM vetchium.hub_professional_email_supersessions
         WHERE previous_home_tenant_id = 'sgp'`,
	).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 1 {
		t.Fatalf("row deleted before acknowledgment: remaining=%d", remaining)
	}

	// Acknowledge it: the row is deleted and a second pull is empty.
	acked, problemDetails, err := service.PullHubProfessionalEmailSupersessions(
		ctx, "sgp", directoryspec.PullHubProfessionalEmailSupersessionsRequest{
			AcknowledgedSeq: first.Supersessions[0].SupersessionSeq, Limit: 10,
		},
	)
	if err != nil || problemDetails != nil || len(acked.Supersessions) != 0 ||
		acked.AcknowledgedSeq != first.Supersessions[0].SupersessionSeq {
		t.Fatalf("acknowledge pull = %+v, problem=%+v, err=%v", acked, problemDetails, err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM vetchium.hub_professional_email_supersessions
         WHERE previous_home_tenant_id = 'sgp'`,
	).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("acknowledged row not deleted: remaining=%d", remaining)
	}

	// The feed is caller-scoped: usa1 (the new holder's own tenant) sees
	// nothing addressed to it from this transfer.
	usa1Pull, problemDetails, err := service.PullHubProfessionalEmailSupersessions(
		ctx, "usa1", directoryspec.PullHubProfessionalEmailSupersessionsRequest{
			AcknowledgedSeq: 0, Limit: 10,
		},
	)
	if err != nil || problemDetails != nil || len(usa1Pull.Supersessions) != 0 {
		t.Fatalf("usa1 pull leaked a sgp-addressed row: %+v", usa1Pull)
	}

	// A regressed request (below the stored watermark) returns the stored
	// cursor rather than erroring.
	regressed, problemDetails, err := service.PullHubProfessionalEmailSupersessions(
		ctx, "sgp", directoryspec.PullHubProfessionalEmailSupersessionsRequest{
			AcknowledgedSeq: 0, Limit: 10,
		},
	)
	if err != nil || problemDetails != nil ||
		regressed.AcknowledgedSeq != acked.AcknowledgedSeq {
		t.Fatalf("regressed pull = %+v, problem=%+v, err=%v", regressed, problemDetails, err)
	}
}

// TestHubProfessionalEmailFeedOrdering verifies GU-GDB-003's core claim: two
// concurrent transfers superseding holders at the same tenant can never let
// a reader observe sequence N+1 without N, because the second transaction's
// sequence allocation blocks on the first's open row lock until it commits.
func TestHubProfessionalEmailFeedOrdering(t *testing.T) {
	pool := newHubEmailTestPool(t)
	service := New(pool, testDigestKeyID)
	ctx := context.Background()
	holderA := activateTestPrincipal(t, service, "sgp", "order-a")
	holderB := activateTestPrincipal(t, service, "sgp", "order-b")
	newHolder1 := activateTestPrincipal(t, service, "usa1", "order-new-1")
	newHolder2 := activateTestPrincipal(t, service, "usa1", "order-new-2")
	digestA := digestFor("order-address-a")
	digestB := digestFor("order-address-b")

	for _, seed := range []struct {
		holder hub.HubUserDID
		digest directoryspec.EmailDigest
		label  string
	}{
		{holderA, digestA, "order-seed-a"},
		{holderB, digestB, "order-seed-b"},
	} {
		if _, err := service.ClaimHubProfessionalEmail(
			ctx, "sgp", directoryspec.ClaimHubProfessionalEmailRequest{
				CommandID:  directoryspec.CommandID(uuidFor(seed.label)),
				HubUserDID: seed.holder, EmailDigest: seed.digest,
				DigestKeyID: testDigestKeyID,
			},
		); err != nil {
			t.Fatal(err)
		}
	}

	// Open a raw transaction that holds the sgp cursor row lock (simulating
	// a transfer in flight) past a synchronization point, so a concurrent
	// transfer via the service is forced to block on it.
	blocker, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := blocker.Exec(
		ctx, `INSERT INTO vetchium.hub_professional_email_feed_cursors (tenant_id)
              VALUES ('sgp') ON CONFLICT DO NOTHING`,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := blocker.Exec(
		ctx, `UPDATE vetchium.hub_professional_email_feed_cursors
              SET last_issued_seq = last_issued_seq + 1
              WHERE tenant_id = 'sgp'`,
	); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := service.ClaimHubProfessionalEmail(
			ctx, "usa1", directoryspec.ClaimHubProfessionalEmailRequest{
				CommandID:  directoryspec.CommandID(uuidFor("order-transfer-a")),
				HubUserDID: newHolder1, EmailDigest: digestA,
				DigestKeyID: testDigestKeyID,
			},
		)
		done <- err
	}()

	select {
	case err := <-done:
		_ = blocker.Rollback(ctx)
		t.Fatalf(
			"concurrent transfer did not block on the held cursor lock: err=%v",
			err,
		)
	case <-time.After(200 * time.Millisecond):
		// Expected: the transfer is blocked behind the open transaction's
		// row lock.
	}

	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatalf("blocked transfer failed after unblocking: %v", err)
	}

	// A second, independent transfer proceeds normally once the first has
	// fully committed.
	if _, err := service.ClaimHubProfessionalEmail(
		ctx, "usa1", directoryspec.ClaimHubProfessionalEmailRequest{
			CommandID:  directoryspec.CommandID(uuidFor("order-transfer-b")),
			HubUserDID: newHolder2, EmailDigest: digestB,
			DigestKeyID: testDigestKeyID,
		},
	); err != nil {
		t.Fatal(err)
	}

	rows, err := pool.Query(ctx,
		`SELECT supersession_seq FROM vetchium.hub_professional_email_supersessions
         WHERE previous_home_tenant_id = 'sgp' ORDER BY supersession_seq`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var sequences []int64
	for rows.Next() {
		var seq int64
		if err := rows.Scan(&seq); err != nil {
			t.Fatal(err)
		}
		sequences = append(sequences, seq)
	}
	// The manually-incremented placeholder row (seq 1, no supersession
	// content, since the blocker only touched the cursor) plus the two real
	// transfers (seq 2 and 3) must appear with no gap, proving no reader
	// could ever have observed seq 3 without seq 2 already committed.
	if len(sequences) != 2 || sequences[0] != 2 || sequences[1] != 3 {
		t.Fatalf("supersession sequences = %v, want [2 3] (no gap)", sequences)
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
