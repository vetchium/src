package signupcompletion

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/credentials"
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

// fakeDirectory echoes back whatever the service asks it to reserve, so the
// test does not need to predict the generated handle or DID, while still
// letting each test case force an email conflict, a bounded number of
// handle conflicts before success, or a specific resolve-hub-account-email
// outcome.
type fakeDirectory struct {
	emailConflict                bool
	handleConflictsBeforeSuccess int
	reserveProblem               *problem.Details
	// duringReserve runs inside the reserve call, after the completion is
	// prepared and before it is marked reserved, to force an interleaving.
	duringReserve func()

	reserveAttempts int
	lastHandle      string
	lastDID         string
	lastTenant      string

	resolveResponse directoryspec.ResolveHubAccountEmailResponse
	resolveProblem  *problem.Details
	resolveErr      error
}

func (f *fakeDirectory) ReserveHubPrincipal(
	_ context.Context, request directoryspec.ReserveHubPrincipalRequest,
) (directoryclient.Outcome, error) {
	f.reserveAttempts++
	if f.duringReserve != nil {
		f.duringReserve()
	}
	if f.reserveProblem != nil {
		return directoryclient.Outcome{Status: 409, Problem: f.reserveProblem}, nil
	}
	if f.emailConflict {
		return directoryclient.Outcome{
			Status:  409,
			Problem: &coordinatorproblem.DirectoryEmailClaimConflictError,
		}, nil
	}
	if f.reserveAttempts <= f.handleConflictsBeforeSuccess {
		return directoryclient.Outcome{
			Status:  409,
			Problem: &coordinatorproblem.DirectoryClaimConflictError,
		}, nil
	}
	f.lastHandle = string(request.Handle)
	f.lastDID = string(request.HubUserDID)
	f.lastTenant = string(request.HomeTenantID)
	return directoryclient.Outcome{
		Status: 200,
		Principal: &directoryspec.PrincipalCommandResponse{
			HubUserDID: request.HubUserDID, Handle: request.Handle,
			HomeTenantID: request.HomeTenantID, RoutingVersion: 1,
			State: directoryspec.PrincipalProvisioning,
		},
	}, nil
}

func (f *fakeDirectory) ActivateHubPrincipal(
	_ context.Context, request directoryspec.ActivateHubPrincipalRequest,
) (directoryclient.Outcome, error) {
	return directoryclient.Outcome{
		Status: 200,
		Principal: &directoryspec.PrincipalCommandResponse{
			HubUserDID:     request.HubUserDID,
			Handle:         hubspec.HubHandle(f.lastHandle),
			HomeTenantID:   directoryspec.TenantID(f.lastTenant),
			RoutingVersion: 1, State: directoryspec.PrincipalActive,
		},
	}, nil
}

func (f *fakeDirectory) ResolveHubAccountEmail(
	context.Context, directoryspec.ResolveHubAccountEmailRequest,
) (directoryspec.ResolveHubAccountEmailResponse, *problem.Details, error) {
	return f.resolveResponse, f.resolveProblem, f.resolveErr
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

// seedSignupRequest inserts an active, unconsumed signup request (and its
// domain, if not already active) for the given email, returning the raw
// token the test hands to Start.
func seedSignupRequest(
	t *testing.T, pool *pgxpool.Pool, email, domain string,
) string {
	t.Helper()
	ctx := context.Background()
	token, tokenHash, err := credentials.NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
        INSERT INTO vetchium.hub_signup_domains (domain, hub_signup_domain_state)
        VALUES ($1, 'active')
        ON CONFLICT (domain) DO UPDATE SET hub_signup_domain_state = 'active'`,
		domain,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
        INSERT INTO vetchium.hub_signup_requests (
            hub_signup_request_id, email_address, display_name,
            preferred_language, resident_country, token_hash, expires_at
        ) VALUES (
            gen_random_uuid(), $1, 'Test User', 'en-US', 'US', $2,
            now() + interval '1 day'
        )`, email, tokenHash,
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `
            DELETE FROM vetchium.hub_signup_completions
            WHERE hub_signup_request_id IN (
                SELECT hub_signup_request_id FROM vetchium.hub_signup_requests
                WHERE email_address = $1
            )`, email)
		_, _ = pool.Exec(context.Background(), `
            DELETE FROM vetchium.hub_signup_requests WHERE email_address = $1`,
			email)
		_, _ = pool.Exec(context.Background(), `
            DELETE FROM vetchium.hub_users WHERE email_address = $1`, email)
		_, _ = pool.Exec(context.Background(), `
            DELETE FROM vetchium.hub_email_outbox
            WHERE recipient_email_address = $1`, email)
	})
	return token
}

func testPayloadKey() [32]byte {
	return sha256.Sum256([]byte("signupcompletion-test-payload-key"))
}

func TestAdvanceFailsWithRegisteredElsewhereAndReplays(t *testing.T) {
	pool := newTestPool(t)
	token := seedSignupRequest(
		t, pool, "email-conflict-test@example.com", "example.com",
	)
	directory := &fakeDirectory{
		emailConflict: true,
		resolveResponse: directoryspec.ResolveHubAccountEmailResponse{
			HomeTenantID: "usa1",
		},
	}
	service := newTestService(pool, directory, nil)
	key := common.IdempotencyKey("signupcompletion-test-key-000000001")
	request := hubauth.CompleteSignupRequest{
		SignupToken: hubauth.HubSignupToken(token),
		Password:    "a-perfectly-fine-password",
	}
	eligible := func(common.CountryCode) bool { return true }

	_, err := service.Start(context.Background(), request, key, eligible)
	var elsewhere *ErrRegisteredElsewhere
	if !errors.As(err, &elsewhere) || elsewhere.HomeTenantID != "usa1" {
		t.Fatalf("Start() error = %v, want ErrRegisteredElsewhere{usa1}", err)
	}

	// A replay of the same request (same token, same idempotency key)
	// returns the identical outcome without re-deriving it.
	_, err = service.Start(context.Background(), request, key, eligible)
	if !errors.As(err, &elsewhere) || elsewhere.HomeTenantID != "usa1" {
		t.Fatalf("replayed Start() error = %v, want the same ErrRegisteredElsewhere", err)
	}

	var state, failureReason string
	if err := pool.QueryRow(context.Background(), `
        SELECT state, failure_reason FROM vetchium.hub_signup_completions
        WHERE hub_signup_request_id = (
            SELECT hub_signup_request_id FROM vetchium.hub_signup_requests
            WHERE email_address = 'email-conflict-test@example.com'
        )`,
	).Scan(&state, &failureReason); err != nil {
		t.Fatal(err)
	}
	if state != "failed" || failureReason != "email_registered_elsewhere" {
		t.Fatalf("stored state = %q, failure_reason = %q", state, failureReason)
	}
}

func TestAdvanceRotatesHandleOnClaimConflictThenCompletes(t *testing.T) {
	pool := newTestPool(t)
	token := seedSignupRequest(
		t, pool, "handle-rotation-test@example.com", "example.com",
	)
	directory := &fakeDirectory{handleConflictsBeforeSuccess: 1}
	service := newTestService(pool, directory, nil)
	key := common.IdempotencyKey("signupcompletion-test-key-000000002")
	request := hubauth.CompleteSignupRequest{
		SignupToken: hubauth.HubSignupToken(token),
		Password:    "a-perfectly-fine-password",
	}
	eligible := func(common.CountryCode) bool { return true }

	result, err := service.Start(context.Background(), request, key, eligible)
	if err != nil || !result.Completed {
		t.Fatalf("Start() = %+v, err = %v, want a completed result", result, err)
	}
	if directory.reserveAttempts != 2 {
		t.Fatalf("reserveAttempts = %d, want 2 (one conflict, one success)",
			directory.reserveAttempts)
	}

	var digest []byte
	if err := pool.QueryRow(context.Background(), `
        SELECT email_digest FROM vetchium.hub_users
        WHERE email_address = 'handle-rotation-test@example.com'`,
	).Scan(&digest); err != nil {
		t.Fatal(err)
	}
	want := fakeDigester{}.HubAccountEmail("handle-rotation-test@example.com")
	if string(digest) != string(want) {
		t.Fatalf("stored email_digest does not match the computed digest")
	}
}

func newTestService(
	pool *pgxpool.Pool, directory Directory, log *slog.Logger,
) *Service {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return New(pool, directory, "sgp", testPayloadKey(), fakeDigester{}, log, nil)
}

// createSignupRequest runs the request-signup statement for email with a
// fresh token, as the request-signup handler does, and returns the new
// request id.
func createSignupRequest(pool *pgxpool.Pool, email string) (pgtype.UUID, error) {
	_, tokenHash, err := credentials.NewToken()
	if err != nil {
		return pgtype.UUID{}, err
	}
	requestID, err := dbvalue.NewUUID()
	if err != nil {
		return pgtype.UUID{}, err
	}
	result, err := sqlc.New(pool).CreateHubSignupRequest(
		context.Background(), sqlc.CreateHubSignupRequestParams{
			EmailDomain: "example.com", EmailAddress: email,
			HubSignupRequestID: requestID, DisplayName: "Replacement User",
			PreferredLanguage: "en-US", ResidentCountry: "US",
			TokenHash:                  tokenHash,
			ExpiresAt:                  dbvalue.Timestamp(time.Now().Add(24 * time.Hour)),
			PayloadCiphertext:          []byte("signup"),
			ElsewherePayloadCiphertext: []byte("elsewhere"),
			TenantID:                   "sgp",
		},
	)
	if err != nil {
		return pgtype.UUID{}, err
	}
	if result != "accepted" {
		return pgtype.UUID{}, fmt.Errorf("CreateHubSignupRequest() = %q, want accepted", result)
	}
	return requestID, nil
}

func requestSignup(t *testing.T, pool *pgxpool.Pool, email string) pgtype.UUID {
	t.Helper()
	requestID, err := createSignupRequest(pool, email)
	if err != nil {
		t.Fatal(err)
	}
	return requestID
}

type signupRequestRow struct {
	id       pgtype.UUID
	active   bool
	consumed bool
}

func signupRequests(t *testing.T, pool *pgxpool.Pool, email string) []signupRequestRow {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
        SELECT hub_signup_request_id, active, consumed_at IS NOT NULL
        FROM vetchium.hub_signup_requests
        WHERE email_address = $1
        ORDER BY created_at`, email)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var requests []signupRequestRow
	for rows.Next() {
		var row signupRequestRow
		if err := rows.Scan(&row.id, &row.active, &row.consumed); err != nil {
			t.Fatal(err)
		}
		requests = append(requests, row)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return requests
}

func countAudit(
	t *testing.T, pool *pgxpool.Pool, action, entityID string,
) int {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(), `
        SELECT count(*) FROM vetchium.audit_events
        WHERE action = $1 AND entity_id = $2`, action, entityID,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// A new signup request for the same address, arriving after the completion
// reserved its global claim but before it created the local user, must not
// take the request over: the completion still finishes with its provisioning
// audit, and the refused request is audited but sends no mail.
func TestSignupRequestDuringCompletionCannotStrandIt(t *testing.T) {
	pool := newTestPool(t)
	const email = "replacement-race-test@example.com"
	token := seedSignupRequest(t, pool, email, "example.com")
	original := signupRequests(t, pool, email)
	if len(original) != 1 {
		t.Fatalf("seeded requests = %+v, want one", original)
	}
	var replacementID pgtype.UUID
	directory := &fakeDirectory{}
	directory.duringReserve = func() {
		replacementID = requestSignup(t, pool, email)
	}
	service := newTestService(pool, directory, nil)

	result, err := service.Start(
		context.Background(),
		hubauth.CompleteSignupRequest{
			SignupToken: hubauth.HubSignupToken(token),
			Password:    "a-perfectly-fine-password",
		},
		common.IdempotencyKey("signupcompletion-test-key-000000003"),
		func(common.CountryCode) bool { return true },
	)
	if err != nil || !result.Completed {
		t.Fatalf("Start() = %+v, err = %v, want completed", result, err)
	}

	requests := signupRequests(t, pool, email)
	if len(requests) != 1 || requests[0].id != original[0].id ||
		requests[0].active || !requests[0].consumed {
		t.Fatalf("requests = %+v, want only the original, consumed and inactive", requests)
	}
	var state string
	if err := pool.QueryRow(context.Background(), `
        SELECT hub_user_state::text FROM vetchium.hub_users
        WHERE email_address = $1`, email,
	).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "active" {
		t.Fatalf("hub_user_state = %q, want active", state)
	}
	if countAudit(t, pool, "hub.user.provisioning", directory.lastDID) != 1 {
		t.Fatal("missing hub.user.provisioning audit event")
	}
	if countAudit(t, pool, "hub.signup.rejected", dbvalue.FormatUUID(replacementID)) != 1 {
		t.Fatal("missing audit for the refused replacement request")
	}
	var mailed int
	if err := pool.QueryRow(context.Background(), `
        SELECT count(*) FROM vetchium.hub_email_outbox
        WHERE recipient_email_address = $1`, email,
	).Scan(&mailed); err != nil {
		t.Fatal(err)
	}
	if mailed != 0 {
		t.Fatalf("outbox rows = %d, want no mail for the refused request", mailed)
	}
}

// A replacement that reaches the request row while PrepareHubSignupCompletion
// still holds it must wait, then see the consumed token and leave the row to
// the new completion.
func TestSignupRequestWaitingOnPrepareDoesNotReplaceIt(t *testing.T) {
	pool := newTestPool(t)
	const email = "prepare-lock-race-test@example.com"
	token := seedSignupRequest(t, pool, email, "example.com")
	original := signupRequests(t, pool, email)
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	ids := make([]pgtype.UUID, 4)
	for i := range ids {
		if ids[i], err = dbvalue.NewUUID(); err != nil {
			t.Fatal(err)
		}
	}
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("prepare-lock-race"))
	if _, err := sqlc.New(tx).PrepareHubSignupCompletion(
		ctx, sqlc.PrepareHubSignupCompletionParams{
			HubSignupRequestID: original[0].id,
			TokenHash:          credentials.TokenHash(token),
			OperationID:        ids[0], IdempotencyKey: "prepare-lock-race",
			RequestDigest: digest[:], AccountEmailDigest: digest[:],
			HubUserDid: did, Handle: "preparel-0000000000a",
			ReserveCommandID: ids[1], ActivateCommandID: ids[2],
			PayloadCiphertext:     []byte("payload"),
			ProvisioningExpiresAt: dbvalue.Timestamp(time.Now().Add(time.Hour)),
			ExpiresAt:             dbvalue.Timestamp(time.Now().Add(2 * time.Hour)),
			TenantID:              "sgp",
		},
	); err != nil {
		t.Fatal(err)
	}

	replaced := make(chan error, 1)
	go func() {
		_, err := createSignupRequest(pool, email)
		replaced <- err
	}()
	select {
	case <-replaced:
		t.Fatal("replacement did not wait for the preparing transaction")
	case <-time.After(300 * time.Millisecond):
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-replaced; err != nil {
		t.Fatal(err)
	}

	requests := signupRequests(t, pool, email)
	if len(requests) != 1 || requests[0].id != original[0].id ||
		!requests[0].active || !requests[0].consumed {
		t.Fatalf("requests = %+v, want the original, active and consumed", requests)
	}
}

// An abandoned completion gives the address back, so a later signup request
// for it starts over with a fresh request.
func TestAbandonedCompletionReleasesTheSignupRequest(t *testing.T) {
	pool := newTestPool(t)
	const email = "abandon-release-test@example.com"
	token := seedSignupRequest(t, pool, email, "example.com")
	directory := &fakeDirectory{reserveProblem: &problem.Details{
		Type: "vetchium-problem-details/test-unavailable",
	}}
	service := newTestService(pool, directory, nil)
	request := hubauth.CompleteSignupRequest{
		SignupToken: hubauth.HubSignupToken(token),
		Password:    "a-perfectly-fine-password",
	}
	key := common.IdempotencyKey("signupcompletion-test-key-000000004")
	eligible := func(common.CountryCode) bool { return true }
	if _, err := service.Start(context.Background(), request, key, eligible); !errors.Is(err, ErrPending) {
		t.Fatalf("Start() error = %v, want ErrPending", err)
	}
	if _, err := pool.Exec(context.Background(), `
        UPDATE vetchium.hub_signup_completions
        SET provisioning_expires_at = created_at + interval '1 microsecond'
        WHERE token_hash = $1`, credentials.TokenHash(token),
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(context.Background(), request, key, eligible); !errors.Is(err, ErrExpired) {
		t.Fatalf("Start() after expiry error = %v, want ErrExpired", err)
	}
	if requests := signupRequests(t, pool, email); len(requests) != 1 || requests[0].active {
		t.Fatalf("requests = %+v, want the abandoned request released", requests)
	}

	replacementID := requestSignup(t, pool, email)
	requests := signupRequests(t, pool, email)
	if len(requests) != 2 || requests[1].id != replacementID ||
		!requests[1].active || requests[1].consumed {
		t.Fatalf("requests = %+v, want a fresh active request", requests)
	}
}

// If a reserved completion's request is somehow no longer active, creating
// the user would leave nothing to consume. No user may be inserted, and an
// operator is told.
func TestReservedCompletionWithoutActiveRequestCreatesNoUser(t *testing.T) {
	pool := newTestPool(t)
	const email = "inactive-request-test@example.com"
	token := seedSignupRequest(t, pool, email, "example.com")
	directory := &fakeDirectory{}
	directory.duringReserve = func() {
		if _, err := pool.Exec(context.Background(), `
            UPDATE vetchium.hub_signup_requests SET active = false
            WHERE email_address = $1`, email,
		); err != nil {
			t.Error(err)
		}
	}
	var output bytes.Buffer
	service := newTestService(
		pool, directory, slog.New(slog.NewJSONHandler(&output, nil)),
	)

	_, err := service.Start(
		context.Background(),
		hubauth.CompleteSignupRequest{
			SignupToken: hubauth.HubSignupToken(token),
			Password:    "a-perfectly-fine-password",
		},
		common.IdempotencyKey("signupcompletion-test-key-000000005"),
		func(common.CountryCode) bool { return true },
	)
	if !errors.Is(err, ErrPending) {
		t.Fatalf("Start() error = %v, want ErrPending", err)
	}
	var users int
	if err := pool.QueryRow(context.Background(), `
        SELECT count(*) FROM vetchium.hub_users WHERE email_address = $1`, email,
	).Scan(&users); err != nil {
		t.Fatal(err)
	}
	var state string
	if err := pool.QueryRow(context.Background(), `
        SELECT state::text FROM vetchium.hub_signup_completions
        WHERE token_hash = $1`, credentials.TokenHash(token),
	).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if users != 0 || state != "reserved" {
		t.Fatalf("users = %d, state = %q, want no user and a reserved completion", users, state)
	}
	if !bytes.Contains(output.Bytes(), []byte(`"event":"hub_signup_request_inactive"`)) ||
		!bytes.Contains(output.Bytes(), []byte(`"level":"ERROR"`)) {
		t.Fatalf("log output = %s, want an error-level inactive request event", output.String())
	}
}

func TestUnexpectedReserveRefusalLogsAnError(t *testing.T) {
	pool := newTestPool(t)
	const email = "digest-mismatch-test@example.com"
	token := seedSignupRequest(t, pool, email, "example.com")
	directory := &fakeDirectory{
		reserveProblem: &coordinatorproblem.DirectoryDigestKeyMismatchError,
	}
	var output bytes.Buffer
	service := newTestService(
		pool, directory, slog.New(slog.NewJSONHandler(&output, nil)),
	)

	_, err := service.Start(
		context.Background(),
		hubauth.CompleteSignupRequest{
			SignupToken: hubauth.HubSignupToken(token),
			Password:    "a-perfectly-fine-password",
		},
		common.IdempotencyKey("signupcompletion-test-key-000000006"),
		func(common.CountryCode) bool { return true },
	)
	if !errors.Is(err, ErrPending) {
		t.Fatalf("Start() error = %v, want ErrPending", err)
	}
	var state, lastError string
	if err := pool.QueryRow(context.Background(), `
        SELECT state::text, last_error FROM vetchium.hub_signup_completions
        WHERE token_hash = $1`, credentials.TokenHash(token),
	).Scan(&state, &lastError); err != nil {
		t.Fatal(err)
	}
	if state != "prepared" ||
		lastError != "reserve global principal: "+coordinatorproblem.DirectoryDigestKeyMismatchError.Type {
		t.Fatalf("state = %q, last_error = %q", state, lastError)
	}
	for _, want := range []string{
		`"level":"ERROR"`, `"event":"hub_signup_directory_refused"`,
		`"reason":"` + coordinatorproblem.DirectoryDigestKeyMismatchError.Type + `"`,
	} {
		if !bytes.Contains(output.Bytes(), []byte(want)) {
			t.Fatalf("log output = %s, want %s", output.String(), want)
		}
	}
	if bytes.Contains(output.Bytes(), []byte(email)) {
		t.Fatalf("log output = %s, must not contain the address", output.String())
	}
}
