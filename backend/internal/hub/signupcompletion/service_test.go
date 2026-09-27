package signupcompletion

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/credentials"
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
	service := New(
		pool, directory, "sgp", testPayloadKey(), fakeDigester{}, nil,
	)
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
	service := New(
		pool, directory, "sgp", testPayloadKey(), fakeDigester{}, nil,
	)
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
