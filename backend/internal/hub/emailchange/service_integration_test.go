package emailchange

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
)

// fakeDigester lets the test compute the exact same digest the service
// computes, without importing backend/internal/identitydigest (this package
// must not: see the AccountEmailDigester doc comment in service.go).
type fakeDigester struct{}

func (fakeDigester) HubAccountEmail(address string) []byte {
	sum := sha256.Sum256([]byte("test-digest\x00" + address))
	return sum[:]
}
func (fakeDigester) ID() string { return "test-key-id" }

// fakeDirectory lets each test force a specific outcome from each of the
// three coordinator commands.
type fakeDirectory struct {
	mu sync.Mutex

	reserveProblem  *problem.Details
	reserveErr      error
	finalizeProblem *problem.Details
	finalizeErr     error
	abandonProblem  *problem.Details
	abandonErr      error

	finalizeCalls int
}

func (f *fakeDirectory) ReserveHubAccountEmailChange(
	context.Context, directoryspec.ReserveHubAccountEmailChangeRequest,
) (directoryclient.EmailChangeOutcome, error) {
	if f.reserveErr != nil {
		return directoryclient.EmailChangeOutcome{}, f.reserveErr
	}
	if f.reserveProblem != nil {
		return directoryclient.EmailChangeOutcome{Problem: f.reserveProblem}, nil
	}
	return directoryclient.EmailChangeOutcome{
		Status: 200,
		Reservation: &directoryspec.HubAccountEmailChangeReservationResponse{
			State: directoryspec.EmailChangeReserved,
		},
	}, nil
}

func (f *fakeDirectory) FinalizeHubAccountEmailChange(
	context.Context, directoryspec.FinalizeHubAccountEmailChangeRequest,
) (directoryclient.EmailChangeOutcome, error) {
	f.mu.Lock()
	f.finalizeCalls++
	f.mu.Unlock()
	if f.finalizeErr != nil {
		return directoryclient.EmailChangeOutcome{}, f.finalizeErr
	}
	if f.finalizeProblem != nil {
		return directoryclient.EmailChangeOutcome{Problem: f.finalizeProblem}, nil
	}
	return directoryclient.EmailChangeOutcome{
		Status: 200,
		Reservation: &directoryspec.HubAccountEmailChangeReservationResponse{
			State: directoryspec.EmailChangeFinalized,
		},
	}, nil
}

func (f *fakeDirectory) AbandonHubAccountEmailChange(
	context.Context, directoryspec.AbandonHubAccountEmailChangeRequest,
) (directoryclient.EmailChangeOutcome, error) {
	if f.abandonErr != nil {
		return directoryclient.EmailChangeOutcome{}, f.abandonErr
	}
	if f.abandonProblem != nil {
		return directoryclient.EmailChangeOutcome{Problem: f.abandonProblem}, nil
	}
	return directoryclient.EmailChangeOutcome{
		Status: 200,
		Reservation: &directoryspec.HubAccountEmailChangeReservationResponse{
			State: directoryspec.EmailChangeCancelled,
		},
	}, nil
}

func newTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func testCodeKey() [32]byte   { return sha256.Sum256([]byte("emailchange-test-code-key")) }
func testOutboxKey() [32]byte { return sha256.Sum256([]byte("emailchange-test-outbox-key")) }

// seedHubUser inserts an active Hub user and one session for it, returning
// both DIDs. The email address is unique per call.
func seedHubUser(t *testing.T, pool *pgxpool.Pool, email string) (pgtype.UUID, pgtype.UUID) {
	t.Helper()
	ctx := context.Background()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	// A handle must match ^[a-z0-9]{8}-[0-9a-hjkmnp-tv-z]{11}$; hex digits are
	// a subset of both character classes, so a hash of the address always
	// produces a valid, unique-enough handle for this fixture.
	sum := sha256.Sum256([]byte(email))
	hexDigest := hex.EncodeToString(sum[:])
	handle := hexDigest[:8] + "-" + hexDigest[8:19]
	if _, err := pool.Exec(ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid,
         subscription_billing_interval, subscription_anchor_at,
         subscription_period_start, subscription_period_end)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')), 'Email Change Test',
                'test-hash', 'SG', 'hub-silver-tier', 'month',
                now() - interval '1 month', now() - interval '1 day',
                now() + interval '1 month')`, did, handle, email,
	); err != nil {
		t.Fatal(err)
	}
	sessionID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	tokenHash := sha256.Sum256([]byte("emailchange-test-session-" + dbvalue.FormatUUID(sessionID)))
	if _, err := pool.Exec(ctx, `INSERT INTO vetchium.hub_sessions
        (hub_session_id, hub_user_did, session_token_hash, expires_at)
        VALUES ($1, $2, $3, now() + interval '1 day')`,
		sessionID, did, tokenHash[:],
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM vetchium.hub_users WHERE hub_user_did = $1`, did)
		// hub_email_outbox has no FK to hub_users (it can address any
		// mailbox), so a prior run's notice for this literal address would
		// otherwise linger and inflate the next run's notice count.
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM vetchium.hub_email_outbox
             WHERE recipient_email_address = $1`, email)
	})
	return did, sessionID
}

// seedChallenge inserts an unconsumed email-change challenge whose code hash
// matches what service.CodeHash computes for code, so Start can verify it.
func seedChallenge(
	t *testing.T, pool *pgxpool.Pool, service *Service,
	hubUserDID, sessionID pgtype.UUID, newAddress, code string,
) pgtype.UUID {
	t.Helper()
	challengeID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `
        INSERT INTO vetchium.hub_email_change_challenges
        (challenge_id, hub_user_did, hub_session_id, new_email_address,
         code_hash, expires_at)
        VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
		challengeID, hubUserDID, sessionID, newAddress,
		service.CodeHash(challengeID, code),
	); err != nil {
		t.Fatal(err)
	}
	return challengeID
}

func newTestService(pool *pgxpool.Pool, directory Directory) *Service {
	return New(pool, directory, "sgp", testCodeKey(), testOutboxKey(), fakeDigester{}, nil)
}

func confirmRequest(challengeID pgtype.UUID, code string) hubauth.ConfirmEmailChangeRequest {
	return hubauth.ConfirmEmailChangeRequest{
		ChallengeID: hubauth.HubEmailChangeChallengeID(dbvalue.FormatUUID(challengeID)),
		Code:        code,
	}
}

func TestStartRejectsWrongCode(t *testing.T) {
	pool := newTestPool(t)
	did, sessionID := seedHubUser(t, pool, "wrong-code-test@example.com")
	service := newTestService(pool, &fakeDirectory{})
	challengeID := seedChallenge(
		t, pool, service, did, sessionID, "wrong-code-new@example.com", "123456",
	)

	key := common.IdempotencyKey("emailchange-test-key-wrong-code-0001")
	_, err := service.Start(
		context.Background(), did, sessionID,
		confirmRequest(challengeID, "999999"), key,
	)
	if !errors.Is(err, ErrCodeRejected) {
		t.Fatalf("Start() error = %v, want ErrCodeRejected", err)
	}

	var attemptCount int
	if err := pool.QueryRow(context.Background(), `
        SELECT attempt_count FROM vetchium.hub_email_change_challenges
        WHERE challenge_id = $1`, challengeID,
	).Scan(&attemptCount); err != nil {
		t.Fatal(err)
	}
	if attemptCount != 1 {
		t.Fatalf("attempt_count = %d, want 1", attemptCount)
	}

	var count int
	if err := pool.QueryRow(context.Background(), `
        SELECT count(*) FROM vetchium.hub_account_email_changes
        WHERE hub_user_did = $1`, did,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("hub_account_email_changes rows = %d, want 0", count)
	}
}

func TestStartSucceedsThroughToSucceeded(t *testing.T) {
	pool := newTestPool(t)
	did, sessionID := seedHubUser(t, pool, "happy-path-test@example.com")
	directory := &fakeDirectory{}
	service := newTestService(pool, directory)
	challengeID := seedChallenge(
		t, pool, service, did, sessionID, "happy-path-new@example.com", "424242",
	)

	key := common.IdempotencyKey("emailchange-test-key-happy-path-0001")
	result, err := service.Start(
		context.Background(), did, sessionID,
		confirmRequest(challengeID, "424242"), key,
	)
	if err != nil || !result.Completed {
		t.Fatalf("Start() = %+v, err = %v, want a completed result", result, err)
	}

	var address string
	var digest []byte
	if err := pool.QueryRow(context.Background(), `
        SELECT email_address, email_digest FROM vetchium.hub_users
        WHERE hub_user_did = $1`, did,
	).Scan(&address, &digest); err != nil {
		t.Fatal(err)
	}
	if address != "happy-path-new@example.com" {
		t.Fatalf("email_address = %q, want the new address", address)
	}
	want := fakeDigester{}.HubAccountEmail("happy-path-new@example.com")
	if string(digest) != string(want) {
		t.Fatal("stored email_digest does not match the computed digest")
	}

	var state string
	if err := pool.QueryRow(context.Background(), `
        SELECT state::text FROM vetchium.federation_operations
        WHERE aggregate_id = $1 AND kind = 'hub-account-email-change'`,
		dbvalue.FormatUUID(did),
	).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "succeeded" {
		t.Fatalf("federation_operations.state = %q, want succeeded", state)
	}
}

func TestStartFailsAddressUnavailableAtReserve(t *testing.T) {
	pool := newTestPool(t)
	did, sessionID := seedHubUser(t, pool, "reserve-conflict-test@example.com")
	directory := &fakeDirectory{
		reserveProblem: &coordinatorproblem.DirectoryEmailClaimConflictError,
	}
	service := newTestService(pool, directory)
	challengeID := seedChallenge(
		t, pool, service, did, sessionID, "reserve-conflict-new@example.com", "111111",
	)

	key := common.IdempotencyKey("emailchange-test-key-reserve-conflict-01")
	_, err := service.Start(
		context.Background(), did, sessionID,
		confirmRequest(challengeID, "111111"), key,
	)
	if !errors.Is(err, ErrAddressUnavailable) {
		t.Fatalf("Start() error = %v, want ErrAddressUnavailable", err)
	}

	var address, state, failureReason string
	if err := pool.QueryRow(context.Background(), `
        SELECT u.email_address, c.state::text, c.failure_reason
        FROM vetchium.hub_account_email_changes AS c
        JOIN vetchium.hub_users AS u USING (hub_user_did)
        WHERE c.hub_user_did = $1`, did,
	).Scan(&address, &state, &failureReason); err != nil {
		t.Fatal(err)
	}
	if address != "reserve-conflict-test@example.com" {
		t.Fatalf("email_address changed to %q, want unchanged", address)
	}
	if state != "failed" || failureReason != "address_unavailable" {
		t.Fatalf("state = %q, failure_reason = %q", state, failureReason)
	}
}

func TestStartCancelsOnReservationExpiredAtReserve(t *testing.T) {
	pool := newTestPool(t)
	did, sessionID := seedHubUser(t, pool, "reservation-expired-test@example.com")
	directory := &fakeDirectory{
		reserveProblem: &coordinatorproblem.DirectoryReservationExpiredError,
	}
	service := newTestService(pool, directory)
	challengeID := seedChallenge(
		t, pool, service, did, sessionID, "reservation-expired-new@example.com", "222222",
	)

	key := common.IdempotencyKey("emailchange-test-key-reservation-expired-1")
	_, err := service.Start(
		context.Background(), did, sessionID,
		confirmRequest(challengeID, "222222"), key,
	)
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Start() error = %v, want ErrUnavailable", err)
	}

	var state, failureReason string
	if err := pool.QueryRow(context.Background(), `
        SELECT state::text, failure_reason FROM vetchium.hub_account_email_changes
        WHERE hub_user_did = $1`, did,
	).Scan(&state, &failureReason); err != nil {
		t.Fatal(err)
	}
	if state != "failed" || failureReason != "reservation_expired" {
		t.Fatalf("state = %q, failure_reason = %q", state, failureReason)
	}
}

func TestStartReplaysSameIdempotencyKeyAfterTransientFailure(t *testing.T) {
	pool := newTestPool(t)
	did, sessionID := seedHubUser(t, pool, "replay-test@example.com")
	directory := &fakeDirectory{finalizeErr: errors.New("coordinator unreachable")}
	service := newTestService(pool, directory)
	challengeID := seedChallenge(
		t, pool, service, did, sessionID, "replay-new@example.com", "333333",
	)

	key := common.IdempotencyKey("emailchange-test-key-replay-0001")
	request := confirmRequest(challengeID, "333333")
	first, err := service.Start(context.Background(), did, sessionID, request, key)
	if !errors.Is(err, ErrPending) || first.OperationID == "" {
		t.Fatalf("Start() = %+v, err = %v, want a pending result", first, err)
	}

	// The transient failure clears; a replay with the same idempotency key
	// picks the same durable change back up and finishes it, rather than
	// re-accepting the (already consumed) challenge.
	directory.finalizeErr = nil
	second, err := service.Start(context.Background(), did, sessionID, request, key)
	if err != nil || !second.Completed {
		t.Fatalf("replayed Start() = %+v, err = %v, want completed", second, err)
	}
	if second.OperationID != first.OperationID {
		t.Fatalf("replay operation id = %q, want %q", second.OperationID, first.OperationID)
	}
}

func TestStartRejectsWhileAnotherChangeIsLive(t *testing.T) {
	pool := newTestPool(t)
	did, sessionID := seedHubUser(t, pool, "in-progress-test@example.com")
	directory := &fakeDirectory{finalizeErr: errors.New("coordinator unreachable")}
	service := newTestService(pool, directory)
	firstChallenge := seedChallenge(
		t, pool, service, did, sessionID, "in-progress-first@example.com", "444444",
	)
	key := common.IdempotencyKey("emailchange-test-key-in-progress-0001")
	if _, err := service.Start(
		context.Background(), did, sessionID,
		confirmRequest(firstChallenge, "444444"), key,
	); !errors.Is(err, ErrPending) {
		t.Fatalf("first Start() error = %v, want ErrPending", err)
	}

	secondChallenge := seedChallenge(
		t, pool, service, did, sessionID, "in-progress-second@example.com", "555555",
	)
	secondKey := common.IdempotencyKey("emailchange-test-key-in-progress-0002")
	_, err := service.Start(
		context.Background(), did, sessionID,
		confirmRequest(secondChallenge, "555555"), secondKey,
	)
	if !errors.Is(err, ErrInProgress) {
		t.Fatalf("second Start() error = %v, want ErrInProgress", err)
	}
}

// seedReservedChange inserts a hub_account_email_changes row (and its
// federation_operations row) directly in the 'reserved' state, bypassing
// Start/Advance, so the concurrency test below can drive both goroutines
// from the same known starting point.
func seedReservedChange(
	t *testing.T, pool *pgxpool.Pool, hubUserDID, sessionID pgtype.UUID, newAddress string,
) pgtype.UUID {
	t.Helper()
	ctx := context.Background()
	q := sqlc.New(pool)
	operationID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	commandID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	oldDigest := fakeDigester{}.HubAccountEmail("concurrent-apply-test@example.com")
	newDigest := fakeDigester{}.HubAccountEmail(newAddress)
	if _, err := q.CreateFederationOperation(ctx, sqlc.CreateFederationOperationParams{
		OperationID: operationID, CommandID: commandID,
		Kind: "hub-account-email-change", TargetAuthority: "global-directory",
		AggregateID:        dbvalue.FormatUUID(hubUserDID),
		OwnerPrincipalType: "hub_user", OwnerPrincipalID: dbvalue.FormatUUID(hubUserDID),
		IdempotencyKey: "seed-reserved-change-" + dbvalue.FormatUUID(operationID),
		RequestDigest:  oldDigest, PayloadBytes: []byte("{}"),
		ExpiresAt: dbvalue.Timestamp(time.Now().Add(7 * 24 * time.Hour)),
	}); err != nil {
		t.Fatal(err)
	}
	reserveID, finalizeID, abandonID := mustNewUUID(t), mustNewUUID(t), mustNewUUID(t)
	if _, err := pool.Exec(ctx, `
        INSERT INTO vetchium.hub_account_email_changes
        (operation_id, hub_user_did, new_email_address, new_email_digest,
         old_email_digest, confirming_session_id, state, reserve_command_id,
         finalize_command_id, abandon_command_id, not_after)
        VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7, $8, $9,
                now() + interval '1 day')`,
		operationID, hubUserDID, newAddress, newDigest, oldDigest, sessionID,
		reserveID, finalizeID, abandonID,
	); err != nil {
		t.Fatal(err)
	}
	return operationID
}

func mustNewUUID(t *testing.T) pgtype.UUID {
	t.Helper()
	id, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// TestConcurrentAdvanceOnlyAppliesOnce drives the same 'reserved' change from
// two goroutines at once (GU-ECH-003): ApplyHubAccountEmailChange's
// FOR UPDATE plus its `state = 'reserved'` guard must let exactly one of
// them perform the local email update and queue the old-address notice; the
// other must see the row has already moved on and fall through to helping
// finish the same operation instead of erroring or double-applying.
func TestConcurrentAdvanceOnlyAppliesOnce(t *testing.T) {
	pool := newTestPool(t)
	did, sessionID := seedHubUser(t, pool, "concurrent-apply-test@example.com")
	directory := &fakeDirectory{}
	service := newTestService(pool, directory)
	operationID := seedReservedChange(t, pool, did, sessionID, "concurrent-apply-new@example.com")

	var start sync.WaitGroup
	start.Add(1)
	var wg sync.WaitGroup
	results := make([]Result, 2)
	errs := make([]error, 2)
	for i := range 2 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			change, err := service.queries.GetHubAccountEmailChangeByOperationID(
				context.Background(), sqlc.GetHubAccountEmailChangeByOperationIDParams{
					OperationID: operationID, HubUserDid: did,
				},
			)
			if err != nil {
				errs[i] = err
				return
			}
			start.Wait()
			results[i], errs[i] = service.Advance(context.Background(), change, "test")
		}(i)
	}
	start.Done()
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d: Advance() error = %v", i, err)
		}
		if !results[i].Completed {
			t.Fatalf("goroutine %d: Advance() = %+v, want completed", i, results[i])
		}
	}

	var address string
	if err := pool.QueryRow(context.Background(), `
        SELECT email_address FROM vetchium.hub_users WHERE hub_user_did = $1`,
		did,
	).Scan(&address); err != nil {
		t.Fatal(err)
	}
	if address != "concurrent-apply-new@example.com" {
		t.Fatalf("email_address = %q, want the new address", address)
	}

	var noticeCount int
	if err := pool.QueryRow(context.Background(), `
        SELECT count(*) FROM vetchium.hub_email_outbox
        WHERE kind = 'email-changed'
          AND recipient_email_address = 'concurrent-apply-test@example.com'`,
	).Scan(&noticeCount); err != nil {
		t.Fatal(err)
	}
	if noticeCount != 1 {
		t.Fatalf("email-changed notices = %d, want exactly 1", noticeCount)
	}
}

// A change whose directory call keeps failing is pushed back on every
// attempt, so it never holds the front of the recovery batch against a
// change that is due.
func TestRecoverBacksOffAStalledChange(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	directory := &fakeDirectory{reserveErr: errors.New("coordinator unreachable")}
	service := newTestService(pool, directory)

	start := func(label string) string {
		t.Helper()
		did, sessionID := seedHubUser(t, pool, label+"-test@example.com")
		challengeID := seedChallenge(
			t, pool, service, did, sessionID, label+"-new@example.com", "616161",
		)
		result, err := service.Start(
			ctx, did, sessionID, confirmRequest(challengeID, "616161"),
			common.IdempotencyKey("emailchange-test-key-"+label+"-0001"),
		)
		if !errors.Is(err, ErrPending) {
			t.Fatalf("Start(%s) error = %v, want ErrPending", label, err)
		}
		return result.OperationID
	}
	schedule := func(operationID string) (int, bool) {
		t.Helper()
		var attempts int
		var deferred bool
		if err := pool.QueryRow(ctx, `SELECT attempt_count,
                next_attempt_at > now()
            FROM vetchium.federation_operations WHERE operation_id = $1`,
			operationID,
		).Scan(&attempts, &deferred); err != nil {
			t.Fatal(err)
		}
		return attempts, deferred
	}

	stalled := start("recover-stalled")
	if _, err := service.Recover(ctx); err != nil {
		t.Fatalf("Recover() error = %v", err)
	}
	if attempts, deferred := schedule(stalled); attempts != 1 || !deferred {
		t.Fatalf("stalled attempts = %d, deferred = %v", attempts, deferred)
	}

	// Stretch the stalled change's backoff past this test's runtime, as
	// repeated failures would, and make a newer change due.
	if _, err := pool.Exec(ctx, `UPDATE vetchium.federation_operations
        SET next_attempt_at = now() + interval '1 hour'
        WHERE operation_id = $1`, stalled); err != nil {
		t.Fatal(err)
	}
	due := start("recover-due")
	directory.reserveErr = nil
	if _, err := service.Recover(ctx); err != nil {
		t.Fatalf("Recover() error = %v", err)
	}

	var dueState, stalledState string
	if err := pool.QueryRow(ctx, `SELECT
            (SELECT state::text FROM vetchium.hub_account_email_changes
             WHERE operation_id = $1),
            (SELECT state::text FROM vetchium.hub_account_email_changes
             WHERE operation_id = $2)`, due, stalled,
	).Scan(&dueState, &stalledState); err != nil {
		t.Fatal(err)
	}
	if dueState != "succeeded" || stalledState != "accepted" {
		t.Fatalf("due = %s, stalled = %s", dueState, stalledState)
	}
	if attempts, _ := schedule(stalled); attempts != 1 {
		t.Fatalf("stalled change retried early: attempts = %d", attempts)
	}
}
