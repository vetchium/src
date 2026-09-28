package professionalemail

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
)

// fakeDigester lets the test compute the exact same digest the service
// computes, without importing backend/internal/identitydigest (this package
// must not: see the Digester doc comment in service.go).
type fakeDigester struct{}

func (fakeDigester) HubProfessionalEmail(address string) []byte {
	sum := sha256.Sum256([]byte("test-professional-digest\x00" + address))
	return sum[:]
}
func (fakeDigester) ID() string { return "test-key-id" }

// fakeDirectory lets each test force a specific outcome from each of the
// four coordinator commands.
type fakeDirectory struct {
	mu sync.Mutex

	claimRevision       int64
	claimSupersededSame *hubspec.HubUserDID
	claimErr            error
	claimProblem        *problem.Details
	claimCalls          int

	releaseErr     error
	releaseProblem *problem.Details
	releaseCalls   int

	pullResponse directoryspec.PullHubProfessionalEmailSupersessionsResponse
	pullErr      error
	pullProblem  *problem.Details

	holdingsResponse directoryspec.CheckHubProfessionalEmailHoldingsResponse
	holdingsErr      error
	holdingsProblem  *problem.Details
}

func (f *fakeDirectory) ClaimHubProfessionalEmail(
	context.Context, directoryspec.ClaimHubProfessionalEmailRequest,
) (directoryclient.ProfessionalClaimOutcome, error) {
	f.mu.Lock()
	f.claimCalls++
	f.mu.Unlock()
	if f.claimErr != nil {
		return directoryclient.ProfessionalClaimOutcome{}, f.claimErr
	}
	if f.claimProblem != nil {
		return directoryclient.ProfessionalClaimOutcome{
			Problem: f.claimProblem,
		}, nil
	}
	return directoryclient.ProfessionalClaimOutcome{
		Status: 200,
		Claim: &directoryspec.ClaimHubProfessionalEmailResponse{
			ClaimRevision:                  f.claimRevision,
			SupersededSameTenantHubUserDID: f.claimSupersededSame,
		},
	}, nil
}

func (f *fakeDirectory) ReleaseHubProfessionalEmail(
	context.Context, directoryspec.ReleaseHubProfessionalEmailRequest,
) (directoryclient.ProfessionalReleaseOutcome, error) {
	f.mu.Lock()
	f.releaseCalls++
	f.mu.Unlock()
	if f.releaseErr != nil {
		return directoryclient.ProfessionalReleaseOutcome{}, f.releaseErr
	}
	if f.releaseProblem != nil {
		return directoryclient.ProfessionalReleaseOutcome{
			Problem: f.releaseProblem,
		}, nil
	}
	return directoryclient.ProfessionalReleaseOutcome{
		Status:  200,
		Release: &directoryspec.ReleaseHubProfessionalEmailResponse{Released: true},
	}, nil
}

func (f *fakeDirectory) PullHubProfessionalEmailSupersessions(
	context.Context, directoryspec.PullHubProfessionalEmailSupersessionsRequest,
) (directoryspec.PullHubProfessionalEmailSupersessionsResponse, *problem.Details, error) {
	return f.pullResponse, f.pullProblem, f.pullErr
}

func (f *fakeDirectory) CheckHubProfessionalEmailHoldings(
	context.Context, directoryspec.CheckHubProfessionalEmailHoldingsRequest,
) (directoryspec.CheckHubProfessionalEmailHoldingsResponse, *problem.Details, error) {
	return f.holdingsResponse, f.holdingsProblem, f.holdingsErr
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

func testCodeKey() [32]byte {
	return sha256.Sum256([]byte("professionalemail-test-code-key"))
}

func newTestService(pool *pgxpool.Pool, directory Directory) *Service {
	return New(pool, directory, "sgp", testCodeKey(), fakeDigester{}, nil)
}

// seedHubUser inserts an active Hub user, returning its DID. The email
// address is unique per call.
func seedHubUser(t *testing.T, pool *pgxpool.Pool, email string) pgtype.UUID {
	t.Helper()
	ctx := context.Background()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(email))
	hexDigest := hex.EncodeToString(sum[:])
	handle := hexDigest[:8] + "-" + hexDigest[8:19]
	if _, err := pool.Exec(ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid,
         subscription_billing_interval, subscription_anchor_at,
         subscription_period_start, subscription_period_end)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')),
                'Professional Email Test', 'test-hash', 'SG',
                'hub-silver-tier', 'month', now() - interval '1 month',
                now() - interval '1 day', now() + interval '1 month')`,
		did, handle, email,
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM vetchium.hub_users WHERE hub_user_did = $1`, did)
	})
	return did
}

// seedProfessionalEmail inserts a professional email row for the given user,
// with the digest fakeDigester computes for address, optionally
// pre-verified.
func seedProfessionalEmail(
	t *testing.T, pool *pgxpool.Pool, hubUserDID pgtype.UUID, address string,
	verifiedAtRevision int64,
) pgtype.UUID {
	t.Helper()
	ctx := context.Background()
	id, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	_, domain, _ := strings.Cut(address, "@")
	digest := fakeDigester{}.HubProfessionalEmail(address)
	if verifiedAtRevision > 0 {
		if _, err := pool.Exec(ctx, `INSERT INTO vetchium.hub_professional_emails
            (professional_email_id, hub_user_did, email_address, domain,
             email_digest, first_verified_at, last_verified_at, claim_revision)
            VALUES ($1, $2, $3, $4, $5, now(), now(), $6)`,
			id, hubUserDID, address, domain, digest, verifiedAtRevision,
		); err != nil {
			t.Fatal(err)
		}
		return id
	}
	if _, err := pool.Exec(ctx, `INSERT INTO vetchium.hub_professional_emails
        (professional_email_id, hub_user_did, email_address, domain, email_digest)
        VALUES ($1, $2, $3, $4, $5)`,
		id, hubUserDID, address, domain, digest,
	); err != nil {
		t.Fatal(err)
	}
	return id
}

// seedChallenge inserts an unconsumed professional-email challenge whose
// code hash matches what service.CodeHash computes for code.
func seedChallenge(
	t *testing.T, pool *pgxpool.Pool, service *Service,
	professionalEmailID pgtype.UUID, code string,
) pgtype.UUID {
	t.Helper()
	challengeID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `
        INSERT INTO vetchium.hub_professional_email_challenges
        (challenge_id, professional_email_id, code_hash, expires_at)
        VALUES ($1, $2, $3, now() + interval '10 minutes')`,
		challengeID, professionalEmailID, service.CodeHash(challengeID, code),
	); err != nil {
		t.Fatal(err)
	}
	return challengeID
}

func verifyRequest(
	professionalEmailID, challengeID pgtype.UUID, code string,
) profilespec.VerifyProfessionalEmailRequest {
	return profilespec.VerifyProfessionalEmailRequest{
		ID:          profilespec.ProfileEntryID(dbvalue.FormatUUID(professionalEmailID)),
		ChallengeID: profilespec.ProfileEntryID(dbvalue.FormatUUID(challengeID)),
		Code:        code,
	}
}

func TestStartRejectsWrongCode(t *testing.T) {
	pool := newTestPool(t)
	did := seedHubUser(t, pool, "wrong-code-test@example.com")
	emailID := seedProfessionalEmail(t, pool, did, "wrong-code-work@example.org", 0)
	service := newTestService(pool, &fakeDirectory{})
	challengeID := seedChallenge(t, pool, service, emailID, "123456")

	key := common.IdempotencyKey("professionalemail-test-key-wrong-code-01")
	_, err := service.Start(
		context.Background(), did, emailID,
		verifyRequest(emailID, challengeID, "999999"), key,
	)
	if !errors.Is(err, ErrCodeRejected) {
		t.Fatalf("Start() error = %v, want ErrCodeRejected", err)
	}
}

func TestStartVerifiesFirstClaim(t *testing.T) {
	pool := newTestPool(t)
	did := seedHubUser(t, pool, "first-claim-test@example.com")
	emailID := seedProfessionalEmail(t, pool, did, "first-claim-work@example.org", 0)
	directory := &fakeDirectory{claimRevision: 1}
	service := newTestService(pool, directory)
	challengeID := seedChallenge(t, pool, service, emailID, "111111")

	key := common.IdempotencyKey("professionalemail-test-key-first-claim-01")
	result, err := service.Start(
		context.Background(), did, emailID,
		verifyRequest(emailID, challengeID, "111111"), key,
	)
	if err != nil || !result.Completed {
		t.Fatalf("Start() = %+v, err = %v, want completed", result, err)
	}

	var lastVerified, supersededAt pgtype.Timestamptz
	var claimRevision pgtype.Int8
	if err := pool.QueryRow(context.Background(), `
        SELECT last_verified_at, superseded_at, claim_revision
        FROM vetchium.hub_professional_emails WHERE professional_email_id = $1`,
		emailID,
	).Scan(&lastVerified, &supersededAt, &claimRevision); err != nil {
		t.Fatal(err)
	}
	if !lastVerified.Valid || supersededAt.Valid ||
		!claimRevision.Valid || claimRevision.Int64 != 1 {
		t.Fatalf(
			"lastVerified=%v supersededAt=%v claimRevision=%v, want verified at revision 1",
			lastVerified, supersededAt, claimRevision,
		)
	}
}

func TestStartMarksClaimOutdatedWhenAlreadySuperseded(t *testing.T) {
	pool := newTestPool(t)
	did := seedHubUser(t, pool, "outdated-claim-test@example.com")
	emailID := seedProfessionalEmail(t, pool, did, "outdated-claim-work@example.org", 0)
	if _, err := pool.Exec(context.Background(), `
        UPDATE vetchium.hub_professional_emails
        SET superseded_revision = 5 WHERE professional_email_id = $1`,
		emailID,
	); err != nil {
		t.Fatal(err)
	}
	directory := &fakeDirectory{claimRevision: 3}
	service := newTestService(pool, directory)
	challengeID := seedChallenge(t, pool, service, emailID, "222222")

	key := common.IdempotencyKey("professionalemail-test-key-outdated-01")
	result, err := service.Start(
		context.Background(), did, emailID,
		verifyRequest(emailID, challengeID, "222222"), key,
	)
	if err != nil || !result.Completed {
		t.Fatalf("Start() = %+v, err = %v, want completed", result, err)
	}

	var lastVerified pgtype.Timestamptz
	if err := pool.QueryRow(context.Background(), `
        SELECT last_verified_at FROM vetchium.hub_professional_emails
        WHERE professional_email_id = $1`, emailID,
	).Scan(&lastVerified); err != nil {
		t.Fatal(err)
	}
	if lastVerified.Valid {
		t.Fatal("outdated claim must not verify the row")
	}
	var count int
	if err := pool.QueryRow(context.Background(), `
        SELECT count(*) FROM vetchium.audit_events
        WHERE action = 'hub.profile.professional-email-claim-outdated'
          AND entity_id = $1`, dbvalue.FormatUUID(emailID),
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("claim-outdated audits = %d, want 1", count)
	}
}

func TestStartEnqueuesReleaseWhenRowDeletedDuringApply(t *testing.T) {
	pool := newTestPool(t)
	did := seedHubUser(t, pool, "deleted-during-apply-test@example.com")
	emailID := seedProfessionalEmail(
		t, pool, did, "deleted-during-apply-work@example.org", 0,
	)
	digest := fakeDigester{}.HubProfessionalEmail(
		"deleted-during-apply-work@example.org",
	)
	directory := &fakeDirectory{claimRevision: 1}
	service := newTestService(pool, directory)

	operationID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	commandID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte(`{"hub_user_did":"` + dbvalue.FormatUUID(did) +
		`","professional_email_id":"` + dbvalue.FormatUUID(emailID) +
		`","email_digest":"` + hex.EncodeToString(digest) + `"}`)
	digestSum := sha256.Sum256(payload)
	q := sqlc.New(pool)
	if _, err := q.CreateFederationOperation(context.Background(),
		sqlc.CreateFederationOperationParams{
			OperationID: operationID, CommandID: commandID,
			Kind: "hub-professional-email-claim", TargetAuthority: "global-directory",
			AggregateID:        dbvalue.FormatUUID(emailID),
			OwnerPrincipalType: "hub_user", OwnerPrincipalID: dbvalue.FormatUUID(did),
			IdempotencyKey: "seed-deleted-during-apply",
			RequestDigest:  digestSum[:], PayloadBytes: payload,
			ExpiresAt: dbvalue.Timestamp(time.Now().Add(24 * time.Hour)),
		},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `
        DELETE FROM vetchium.hub_professional_emails
        WHERE professional_email_id = $1`, emailID,
	); err != nil {
		t.Fatal(err)
	}

	operation, err := q.GetFederationOperation(context.Background(), operationID)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.Advance(context.Background(), operation, "test")
	if err != nil || !result.Completed {
		t.Fatalf("Advance() = %+v, err = %v, want completed", result, err)
	}

	var releaseCount int
	if err := pool.QueryRow(context.Background(), `
        SELECT count(*) FROM vetchium.federation_operations
        WHERE kind = 'hub-professional-email-release'
          AND aggregate_id = $1`, dbvalue.FormatUUID(emailID),
	).Scan(&releaseCount); err != nil {
		t.Fatal(err)
	}
	if releaseCount != 1 {
		t.Fatalf("enqueued release operations = %d, want 1", releaseCount)
	}
}

func TestStartAppliesSameTenantSupersession(t *testing.T) {
	pool := newTestPool(t)
	newHolder := seedHubUser(t, pool, "new-holder-test@example.com")
	previousHolder := seedHubUser(t, pool, "previous-holder-test@example.com")
	const address = "shared-work@example.org"
	newEmailID := seedProfessionalEmail(t, pool, newHolder, address, 0)
	previousEmailID := seedProfessionalEmail(t, pool, previousHolder, address, 1)

	previousDID := hubspec.HubUserDID(dbvalue.FormatUUID(previousHolder))
	directory := &fakeDirectory{
		claimRevision: 5, claimSupersededSame: &previousDID,
	}
	service := newTestService(pool, directory)
	challengeID := seedChallenge(t, pool, service, newEmailID, "333333")

	key := common.IdempotencyKey("professionalemail-test-key-transfer-01")
	result, err := service.Start(
		context.Background(), newHolder, newEmailID,
		verifyRequest(newEmailID, challengeID, "333333"), key,
	)
	if err != nil || !result.Completed {
		t.Fatalf("Start() = %+v, err = %v, want completed", result, err)
	}

	var previousSuperseded pgtype.Timestamptz
	var previousSupersededRevision int64
	if err := pool.QueryRow(context.Background(), `
        SELECT superseded_at, superseded_revision
        FROM vetchium.hub_professional_emails WHERE professional_email_id = $1`,
		previousEmailID,
	).Scan(&previousSuperseded, &previousSupersededRevision); err != nil {
		t.Fatal(err)
	}
	if !previousSuperseded.Valid || previousSupersededRevision != 5 {
		t.Fatalf(
			"previous holder superseded_at=%v superseded_revision=%d, want set at 5",
			previousSuperseded, previousSupersededRevision,
		)
	}
}

func TestAdvanceReleaseResolvesSucceeded(t *testing.T) {
	pool := newTestPool(t)
	did := seedHubUser(t, pool, "release-test@example.com")
	directory := &fakeDirectory{}
	service := newTestService(pool, directory)

	operationID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	commandID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	digest := fakeDigester{}.HubProfessionalEmail("release-test-work@example.org")
	payload := []byte(`{"hub_user_did":"` + dbvalue.FormatUUID(did) +
		`","email_digest":"` + hex.EncodeToString(digest) + `","claim_revision":1}`)
	digestSum := sha256.Sum256(payload)
	q := sqlc.New(pool)
	if _, err := q.CreateFederationOperation(context.Background(),
		sqlc.CreateFederationOperationParams{
			OperationID: operationID, CommandID: commandID,
			Kind: "hub-professional-email-release", TargetAuthority: "global-directory",
			AggregateID:        dbvalue.FormatUUID(did),
			OwnerPrincipalType: "hub_user", OwnerPrincipalID: dbvalue.FormatUUID(did),
			IdempotencyKey: "seed-release-test",
			RequestDigest:  digestSum[:], PayloadBytes: payload,
			ExpiresAt: dbvalue.Timestamp(time.Now().Add(24 * time.Hour)),
		},
	); err != nil {
		t.Fatal(err)
	}
	operation, err := q.GetFederationOperation(context.Background(), operationID)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.Advance(context.Background(), operation, "test")
	if err != nil || !result.Completed {
		t.Fatalf("Advance() = %+v, err = %v, want completed", result, err)
	}
	if directory.releaseCalls != 1 {
		t.Fatalf("releaseCalls = %d, want 1", directory.releaseCalls)
	}
}

func TestSyncSupersessionsAppliesAndAdvancesWatermark(t *testing.T) {
	pool := newTestPool(t)
	did := seedHubUser(t, pool, "sync-supersede-test@example.com")
	const address = "sync-supersede-work@example.org"
	emailID := seedProfessionalEmail(t, pool, did, address, 1)
	digest := fakeDigester{}.HubProfessionalEmail(address)

	if _, err := pool.Exec(context.Background(), `
        DELETE FROM vetchium.global_feed_watermarks
        WHERE feed = 'hub-professional-email-supersessions'`,
	); err != nil {
		t.Fatal(err)
	}

	directory := &fakeDirectory{
		pullResponse: directoryspec.PullHubProfessionalEmailSupersessionsResponse{
			Supersessions: []directoryspec.HubProfessionalEmailSupersession{
				{
					SupersessionSeq: 42,
					HubUserDID:      hubspec.HubUserDID(dbvalue.FormatUUID(did)),
					EmailDigest: directoryspec.EmailDigest(
						hex.EncodeToString(digest),
					),
					SupersededByRevision: 9,
				},
			},
			AcknowledgedSeq: 0,
		},
	}
	service := newTestService(pool, directory)
	result, err := service.SyncSupersessions(context.Background())
	if err != nil {
		t.Fatalf("SyncSupersessions() error = %v", err)
	}
	if result.GapDetected {
		t.Fatal("SyncSupersessions() reported a gap for a normal in-order pull")
	}

	var supersededAt pgtype.Timestamptz
	var supersededRevision int64
	if err := pool.QueryRow(context.Background(), `
        SELECT superseded_at, superseded_revision
        FROM vetchium.hub_professional_emails WHERE professional_email_id = $1`,
		emailID,
	).Scan(&supersededAt, &supersededRevision); err != nil {
		t.Fatal(err)
	}
	if !supersededAt.Valid || supersededRevision != 9 {
		t.Fatalf(
			"supersededAt=%v supersededRevision=%d, want set at 9",
			supersededAt, supersededRevision,
		)
	}

	var watermark int64
	if err := pool.QueryRow(context.Background(), `
        SELECT last_seq FROM vetchium.global_feed_watermarks
        WHERE feed = 'hub-professional-email-supersessions'`,
	).Scan(&watermark); err != nil {
		t.Fatal(err)
	}
	if watermark != 42 {
		t.Fatalf("watermark = %d, want 42", watermark)
	}
}

func TestSweepHoldingsSupersedesRowNotHeldAnymore(t *testing.T) {
	pool := newTestPool(t)
	did := seedHubUser(t, pool, "sweep-test@example.com")
	emailID := seedProfessionalEmail(t, pool, did, "sweep-test-work@example.org", 3)

	directory := &fakeDirectory{
		holdingsResponse: directoryspec.CheckHubProfessionalEmailHoldingsResponse{
			Results: []directoryspec.HubProfessionalEmailHoldingResult{
				{HeldByRequestedUser: false},
			},
		},
	}
	service := newTestService(pool, directory)
	if err := service.SweepHoldings(context.Background()); err != nil {
		t.Fatalf("SweepHoldings() error = %v", err)
	}

	var supersededAt pgtype.Timestamptz
	if err := pool.QueryRow(context.Background(), `
        SELECT superseded_at FROM vetchium.hub_professional_emails
        WHERE professional_email_id = $1`, emailID,
	).Scan(&supersededAt); err != nil {
		t.Fatal(err)
	}
	if !supersededAt.Valid {
		t.Fatal("sweep must supersede a row the coordinator no longer holds for this user")
	}
}
