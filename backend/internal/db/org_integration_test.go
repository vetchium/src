package db

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// Run against a migrated disposable tenant database. Every case runs in a
// transaction that is rolled back, so shared developer data is untouched.
func TestOrgSignupAndDomainLifecycleIntegration(t *testing.T) {
	pool := orgTestPool(t)
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)

	domain := "acme-" + strings.ReplaceAll(dbvalue.FormatUUID(orgTestUUID(t)), "-", "")[:12] + ".example"
	email := "it@" + domain
	request := func(address, token string) string {
		t.Helper()
		result, err := q.CreateOrgSignupRequest(ctx, sqlc.CreateOrgSignupRequestParams{
			OrgSignupRequestID:    orgTestUUID(t),
			EmailAddress:          address,
			Domain:                address[strings.LastIndexByte(address, '@')+1:],
			PreferredLanguage:     "en-US",
			VerificationToken:     token,
			TokenHash:             orgTestHash(address + token),
			ExpiresAt:             dbvalue.Timestamp(time.Now().Add(time.Hour)),
			DnsPayloadCiphertext:  []byte("dns"),
			LinkPayloadCiphertext: []byte("link"),
			TenantID:              "sgp",
			IdempotencyKey:        dbvalue.Text("key-" + token),
		})
		if err != nil {
			t.Fatalf("request signup for %s: %v", address, err)
		}
		return result
	}

	if got := request("it@gmail.com", strings.Repeat("a", 26)); got != "blocked" {
		t.Fatalf("public mailbox provider result = %q", got)
	}
	if got := request("it@corp.gmail.com", strings.Repeat("b", 26)); got != "blocked" {
		t.Fatalf("subdomain of a provider result = %q", got)
	}
	if got := request(email, strings.Repeat("c", 26)); got != "accepted" {
		t.Fatalf("first request = %q", got)
	}
	// A repeat from the same address supersedes the earlier pending signup.
	if got := request(email, strings.Repeat("d", 26)); got != "accepted" {
		t.Fatalf("superseding request = %q", got)
	}
	if got := request("other@"+domain, strings.Repeat("e", 26)); got != "accepted" {
		t.Fatalf("second address for the same domain = %q", got)
	}
	var pending, queued int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vetchium.org_signup_requests
        WHERE domain = $1 AND active`, domain).Scan(&pending); err != nil || pending != 2 {
		t.Fatalf("active signups = %d, %v", pending, err)
	}
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vetchium.org_email_outbox
        WHERE recipient_email_address = $1`, email).Scan(&queued); err != nil || queued != 4 {
		t.Fatalf("queued emails for %s = %d, %v", email, queued, err)
	}
	if _, err := q.GetOrgSignupDetails(ctx, orgTestHash(email+strings.Repeat("c", 26))); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("superseded link still resolves: %v", err)
	}
	signup, err := q.FindOrgSignupForCompletion(ctx, orgTestHash(email+strings.Repeat("d", 26)))
	if err != nil || signup.Domain != domain {
		t.Fatalf("signup = %+v, %v", signup, err)
	}

	orgDID, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := q.PrepareOrgSignupCompletion(ctx, sqlc.PrepareOrgSignupCompletionParams{
		OrgSignupRequestID: signup.OrgSignupRequestID,
		TokenHash:          orgTestHash(email + strings.Repeat("d", 26)),
		OperationID:        orgTestUUID(t), IdempotencyKey: "complete",
		RequestDigest: make([]byte, 32), OrgDid: orgDID,
		ReserveCommandID: orgTestUUID(t), ActivateCommandID: orgTestUUID(t),
		PayloadCiphertext:     []byte("payload"),
		ProvisioningExpiresAt: dbvalue.Timestamp(time.Now().Add(time.Hour)),
		ExpiresAt:             dbvalue.Timestamp(time.Now().Add(2 * time.Hour)),
		TenantID:              "sgp",
	})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if err := q.RecordOrgSignupCompletionRetry(ctx, sqlc.RecordOrgSignupCompletionRetryParams{
		OperationID: prepared.OperationID, LastError: "directory timeout",
		TenantID: "sgp", Source: "orgs-api",
	}); err != nil {
		t.Fatalf("record retry: %v", err)
	}
	if _, err := q.MarkOrgSignupCompletionReserved(ctx, sqlc.MarkOrgSignupCompletionReservedParams{
		OperationID: prepared.OperationID, ReserveCommandID: prepared.ReserveCommandID,
		TenantID: "sgp", Source: "orgs-api",
	}); err != nil {
		t.Fatalf("mark reserved: %v", err)
	}
	if _, err := q.CreateProvisioningOrg(ctx, sqlc.CreateProvisioningOrgParams{
		OperationID: prepared.OperationID, DisplayName: "Acme",
		OrgPlanOid: "org-free-tier", VerificationToken: strings.Repeat("d", 26),
		NextCheckAt:  dbvalue.Timestamp(time.Now().Add(time.Hour)),
		EmailAddress: email, PreferredLanguage: "en-US", PasswordHash: "hash",
		TenantID: "sgp", Source: "orgs-api",
	}); err != nil {
		t.Fatalf("create provisioning Org: %v", err)
	}
	login := sqlc.GetOrgUserForLoginParams{Domain: domain, EmailAddress: email}
	if _, err := q.GetOrgUserForLogin(ctx, login); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("provisioning Org user can sign in: %v", err)
	}
	if _, err := q.CompleteProvisioningOrg(ctx, sqlc.CompleteProvisioningOrgParams{
		OperationID: prepared.OperationID, TenantID: "sgp", Source: "orgs-api",
	}); err != nil {
		t.Fatalf("complete provisioning Org: %v", err)
	}
	user, err := q.GetOrgUserForLogin(ctx, login)
	if err != nil || user.PasswordHash != "hash" || user.TotpEnabled ||
		user.OrgUserState != sqlc.VetchiumOrgUserStateActive {
		t.Fatalf("login user = %+v, %v", user, err)
	}
	held, err := q.OrgUserHoldsPermission(ctx, sqlc.OrgUserHoldsPermissionParams{
		OrgUserID: user.OrgUserID, Permission: "org:superadmin",
	})
	if err != nil || !held {
		t.Fatalf("first user superadmin = %t, %v", held, err)
	}

	// The domain is now owned locally: new requests and the other pending
	// signup are refused.
	if got := request("late@"+domain, strings.Repeat("f", 26)); got != "owned" {
		t.Fatalf("request for an owned domain = %q", got)
	}
	admission, err := q.CheckOrgDomainAdmission(ctx, domain)
	if err != nil || !admission.LocallyOwned || admission.Blocked {
		t.Fatalf("admission = %+v, %v", admission, err)
	}
	other, err := q.FindOrgSignupForCompletion(ctx, orgTestHash("other@"+domain+strings.Repeat("e", 26)))
	if err != nil {
		t.Fatal(err)
	}
	otherDID, _ := dbvalue.NewUUIDv7(time.Now())
	if _, err := q.PrepareOrgSignupCompletion(ctx, sqlc.PrepareOrgSignupCompletionParams{
		OrgSignupRequestID: other.OrgSignupRequestID,
		TokenHash:          orgTestHash("other@" + domain + strings.Repeat("e", 26)),
		OperationID:        orgTestUUID(t), IdempotencyKey: "other",
		RequestDigest: make([]byte, 32), OrgDid: otherDID,
		ReserveCommandID: orgTestUUID(t), ActivateCommandID: orgTestUUID(t),
		PayloadCiphertext:     []byte("payload"),
		ProvisioningExpiresAt: dbvalue.Timestamp(time.Now().Add(time.Hour)),
		ExpiresAt:             dbvalue.Timestamp(time.Now().Add(2 * time.Hour)),
		TenantID:              "sgp",
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("second signup for an owned domain prepared: %v", err)
	}

	check := func(state sqlc.VetchiumOrgDomainState) sqlc.RecordOrgDomainAbsentRow {
		t.Helper()
		row, err := q.RecordOrgDomainAbsent(ctx, sqlc.RecordOrgDomainAbsentParams{
			OrgDid: orgDID, ExpectedState: state, FailureThreshold: 2,
			NextCheckAt:             dbvalue.Timestamp(time.Now().Add(time.Hour)),
			NoticePayloadCiphertext: []byte("notice"),
			TenantID:                "sgp", ActorType: "worker",
			ActorID: dbvalue.Text("verify-org-domains"), Source: "workers",
		})
		if err != nil {
			t.Fatalf("record absent: %v", err)
		}
		return row
	}
	if row := check(sqlc.VetchiumOrgDomainStateVerified); !row.Recorded || row.BecameFailing {
		t.Fatalf("first absent result = %+v", row)
	}
	if row := check(sqlc.VetchiumOrgDomainStateVerified); !row.BecameFailing {
		t.Fatalf("second absent result = %+v", row)
	}
	if row := check(sqlc.VetchiumOrgDomainStateVerified); row.Recorded {
		t.Fatal("a stale verified state was applied to a failing domain")
	}
	if row := check(sqlc.VetchiumOrgDomainStateFailing); !row.Recorded || row.BecameFailing {
		t.Fatalf("absent while failing = %+v", row)
	}
	var notices int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vetchium.org_email_outbox
        WHERE kind = 'domain-failing' AND recipient_email_address = $1`, email).Scan(&notices); err != nil || notices != 1 {
		t.Fatalf("failing notices = %d, %v", notices, err)
	}

	info, err := q.GetOrgMyInfo(ctx, user.OrgUserID)
	if err != nil || info.DomainState != sqlc.VetchiumOrgDomainStateFailing ||
		!info.FailingSince.Valid || len(info.Permissions) != 1 {
		t.Fatalf("my info = %+v, %v", info, err)
	}

	past, err := q.ListOrgDomainsPastGrace(ctx, dbvalue.Timestamp(time.Now().Add(time.Minute)))
	if err != nil || !orgDomainListed(past, orgDID) {
		t.Fatalf("past grace = %+v, %v", past, err)
	}
	releaseCommand := orgTestUUID(t)
	started, err := q.BeginOrgDomainRelease(ctx, sqlc.BeginOrgDomainReleaseParams{
		OrgDid: orgDID, DirectoryCommandID: releaseCommand,
		FailingBefore:           dbvalue.Timestamp(time.Now().Add(time.Minute)),
		NoticePayloadCiphertext: []byte("suspended"), TenantID: "sgp",
	})
	if err != nil || !started {
		t.Fatalf("begin release = %t, %v", started, err)
	}
	if _, err := q.AuthenticateOrgSession(ctx, make([]byte, 32)); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("unknown session authenticated: %v", err)
	}
	if user, err := q.GetOrgUserForLogin(ctx, login); err != nil || user.OrgDid != orgDID {
		t.Fatalf("suspended Org user cannot sign in: %+v, %v", user, err)
	}
	completed, err := q.CompleteOrgDomainRelease(ctx, sqlc.CompleteOrgDomainReleaseParams{
		OrgDid: orgDID, DirectoryCommandID: releaseCommand,
		NextCheckAt: dbvalue.Timestamp(time.Now().Add(time.Hour)),
		TenantID:    "sgp", ActorType: "worker",
		ActorID: dbvalue.Text("verify-org-domains"), Source: "workers",
	})
	if err != nil || !completed {
		t.Fatalf("complete release = %t, %v", completed, err)
	}
	if known, err := q.CheckOrgDomainAdmission(ctx, domain); err != nil || known.LocallyOwned {
		t.Fatalf("released domain still owned: %+v, %v", known, err)
	}

	reclaim := orgTestUUID(t)
	if ok, err := q.BeginOrgDomainReclaim(ctx, sqlc.BeginOrgDomainReclaimParams{
		OrgDid: orgDID, DirectoryCommandID: reclaim, TenantID: "sgp",
		ActorType: "org_user", ActorID: dbvalue.Text("test"), Source: "orgs-api",
	}); err != nil || !ok {
		t.Fatalf("begin reclaim = %t, %v", ok, err)
	}
	if ok, err := q.RejectOrgDomainReclaim(ctx, sqlc.RejectOrgDomainReclaimParams{
		OrgDid: orgDID, DirectoryCommandID: reclaim,
		NextCheckAt: dbvalue.Timestamp(time.Now().Add(time.Hour)),
		TenantID:    "sgp", ActorType: "worker",
		ActorID: dbvalue.Text("verify-org-domains"), Source: "workers",
	}); err != nil || !ok {
		t.Fatalf("reject reclaim = %t, %v", ok, err)
	}
	reclaim = orgTestUUID(t)
	if _, err := q.BeginOrgDomainReclaim(ctx, sqlc.BeginOrgDomainReclaimParams{
		OrgDid: orgDID, DirectoryCommandID: reclaim, TenantID: "sgp",
		ActorType: "worker", ActorID: dbvalue.Text("verify-org-domains"),
		Source: "workers",
	}); err != nil {
		t.Fatal(err)
	}
	if ok, err := q.CompleteOrgDomainReclaim(ctx, sqlc.CompleteOrgDomainReclaimParams{
		OrgDid: orgDID, DirectoryCommandID: reclaim,
		NextCheckAt: dbvalue.Timestamp(time.Now().Add(time.Hour)),
		TenantID:    "sgp", ActorType: "worker",
		ActorID: dbvalue.Text("verify-org-domains"), Source: "workers",
	}); err != nil || !ok {
		t.Fatalf("complete reclaim = %t, %v", ok, err)
	}
	info, err = q.GetOrgMyInfo(ctx, user.OrgUserID)
	if err != nil || info.OrgState != sqlc.VetchiumOrgStateActive ||
		info.DomainState != sqlc.VetchiumOrgDomainStateVerified {
		t.Fatalf("after reclaim = %+v, %v", info, err)
	}

	// Every write above committed its audit event in the same statement.
	counts := map[string]int{}
	rows, err := tx.Query(ctx, `SELECT action, count(*) FROM vetchium.audit_events
        WHERE entity_id IN ($1, $2, $3)
           OR idempotency_key IN ('complete', 'key-`+strings.Repeat("c", 26)+`',
                                  'key-`+strings.Repeat("d", 26)+`')
        GROUP BY action`,
		dbvalue.FormatUUID(orgDID), dbvalue.FormatUUID(user.OrgUserID),
		dbvalue.FormatUUID(prepared.OperationID))
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var action string
		var count int
		if err := rows.Scan(&action, &count); err != nil {
			t.Fatal(err)
		}
		counts[action] = count
	}
	rows.Close()
	for action, want := range map[string]int{
		"org.signup.requested":                  2,
		"org.signup.completion_prepared":        1,
		"org.signup.completion_retry_scheduled": 1,
		"org.signup.completion_reserved":        1,
		"org.provisioning":                      1,
		"org.created":                           1,
		"org_user.created":                      1,
		"org.domain.checked":                    3,
		"org.domain.release-started":            1,
		"org.suspended":                         1,
		"org.domain.released":                   1,
		"org.domain.reclaim-started":            2,
		"org.domain.reclaim-rejected":           1,
		"org.domain.reclaimed":                  1,
		"org.reactivated":                       1,
	} {
		if counts[action] != want {
			t.Errorf("audit %s = %d, want %d (all: %v)", action, counts[action], want, counts)
		}
	}
	// The stale absent result above changed nothing, so it recorded nothing.
	var stale int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vetchium.audit_events
        WHERE action = 'org.domain.checked' AND entity_id = $1
          AND payload ->> 'previous_state' = 'verified'
          AND payload ->> 'state' = 'failing'`,
		dbvalue.FormatUUID(orgDID)).Scan(&stale); err != nil || stale != 1 {
		t.Fatalf("verified-to-failing checks = %d, %v", stale, err)
	}
}

func TestOrgSignupCompletionPruneIsAuditedIntegration(t *testing.T) {
	pool := orgTestPool(t)
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if _, err := tx.Exec(ctx, `DELETE FROM vetchium.org_signup_completions`); err != nil {
		t.Fatal(err)
	}
	if deleted, err := q.PruneExpiredOrgSignupCompletions(ctx, "sgp"); err != nil || deleted != 0 {
		t.Fatalf("empty prune = %d, %v", deleted, err)
	}
	did, _ := dbvalue.NewUUIDv7(time.Now())
	if _, err := tx.Exec(ctx, `INSERT INTO vetchium.org_signup_completions (
            operation_id, org_signup_request_id, token_hash, idempotency_key,
            request_digest, org_did, domain, reserve_command_id,
            activate_command_id, payload_ciphertext, state, failure_reason,
            provisioning_expires_at, created_at, updated_at, completed_at,
            expires_at)
        VALUES (gen_random_uuid(), gen_random_uuid(),
            decode(repeat('01', 32), 'hex'), 'prune', decode(repeat('02', 32), 'hex'),
            $1, 'prune.example', gen_random_uuid(), gen_random_uuid(), '\x',
            'failed', 'reservation_expired', now() - interval '2 days',
            now() - interval '3 days', now() - interval '3 days',
            now() - interval '2 days', now() - interval '1 day')`, did); err != nil {
		t.Fatal(err)
	}
	deleted, err := q.PruneExpiredOrgSignupCompletions(ctx, "sgp")
	if err != nil || deleted != 1 {
		t.Fatalf("prune = %d, %v", deleted, err)
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vetchium.audit_events
        WHERE action = 'org.housekeeping.signup-completions-pruned'
          AND payload ->> 'deleted_count' = '1'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("prune audit events = %d, %v", count, err)
	}
}

func TestOrgSchemaConstraintsIntegration(t *testing.T) {
	pool := orgTestPool(t)
	ctx := context.Background()
	for name, statement := range map[string]string{
		"email domain must equal the claimed domain": `INSERT INTO
            vetchium.org_signup_requests (org_signup_request_id,
            email_address, domain, preferred_language, verification_token,
            token_hash, expires_at)
            VALUES (gen_random_uuid(), 'it@other.example.com',
            'example.com', 'en-US', 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
            decode(repeat('00', 32), 'hex'), now() + interval '1 hour')`,
		"numeric last label is not a domain": `INSERT INTO
            vetchium.org_signup_blocked_domains (domain)
            VALUES ('example.123')`,
		"org DID must be UUIDv7": `INSERT INTO vetchium.orgs
            (org_did, display_name, org_plan_oid)
            VALUES (gen_random_uuid(), 'Acme', 'org-free-tier')`,
		"suspension timestamp matches state": `INSERT INTO vetchium.orgs
            (org_did, display_name, org_state, org_plan_oid)
            VALUES ('018f7e32-7b5a-7d31-8fd0-f7e2a852f144', 'Acme',
            'suspended', 'org-free-tier')`,
		"only catalog permissions can be granted": `INSERT INTO
            vetchium.org_permission_catalog (permission)
            VALUES ('admin:view_users')`,
	} {
		t.Run(name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = tx.Rollback(ctx) }()
			_, err = tx.Exec(ctx, statement)
			var databaseError *pgconn.PgError
			if !errors.As(err, &databaseError) ||
				(databaseError.Code != "23514" && databaseError.Code != "23503") {
				t.Fatalf("err = %v, want a check or foreign-key violation", err)
			}
		})
	}
}

func orgTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func orgTestUUID(t *testing.T) pgtype.UUID {
	t.Helper()
	id, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func orgTestHash(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}

func orgDomainListed(rows []sqlc.ListOrgDomainsPastGraceRow, did pgtype.UUID) bool {
	for _, row := range rows {
		if row.OrgDid == did {
			return true
		}
	}
	return false
}
