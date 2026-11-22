package db

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

func TestHubSignupDetailsFollowTheLinkIntegration(t *testing.T) {
	pool := orgTestPool(t)
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)

	domain := "details-" + strings.ReplaceAll(
		dbvalue.FormatUUID(orgTestUUID(t)), "-", "",
	) + ".example"
	if _, err := tx.Exec(
		ctx, `INSERT INTO vetchium.hub_signup_domains (domain) VALUES ($1)`, domain,
	); err != nil {
		t.Fatal(err)
	}

	type link struct {
		email     string
		hash      []byte
		requestID pgtype.UUID
	}
	issue := func(name, token string) link {
		t.Helper()
		params := sqlc.CreateHubSignupRequestParams{
			EmailDomain: domain, EmailAddress: name + "@" + domain,
			HubSignupRequestID: orgTestUUID(t), DisplayName: "Asha",
			PreferredLanguage: "en-US", ResidentCountry: "SG",
			TokenHash:                  orgTestHash(domain + name + token),
			ExpiresAt:                  dbvalue.Timestamp(time.Now().Add(time.Hour)),
			PayloadCiphertext:          []byte("link"),
			ElsewherePayloadCiphertext: []byte("elsewhere"),
			TenantID:                   "test",
		}
		if _, err := q.CreateHubSignupRequest(ctx, params); err != nil {
			t.Fatal(err)
		}
		return link{params.EmailAddress, params.TokenHash, params.HubSignupRequestID}
	}
	opens := func(state string, signup link) {
		t.Helper()
		email, err := q.GetHubSignupDetails(ctx, signup.hash)
		if err != nil || email != signup.email {
			t.Fatalf("%s link: email = %q, error = %v", state, email, err)
		}
	}
	refuses := func(state string, signup link) {
		t.Helper()
		if email, err := q.GetHubSignupDetails(ctx, signup.hash); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("%s link: email = %q, error = %v", state, email, err)
		}
	}
	prepare := func(signup link) sqlc.PrepareHubSignupCompletionParams {
		t.Helper()
		did, err := dbvalue.NewUUIDv7(time.Now())
		if err != nil {
			t.Fatal(err)
		}
		compact := strings.ReplaceAll(dbvalue.FormatUUID(orgTestUUID(t)), "-", "")
		params := sqlc.PrepareHubSignupCompletionParams{
			HubSignupRequestID: signup.requestID,
			TokenHash:          signup.hash,
			OperationID:        orgTestUUID(t), IdempotencyKey: compact,
			RequestDigest:         orgTestHash("request" + compact),
			AccountEmailDigest:    orgTestHash(signup.email),
			HubUserDid:            did,
			Handle:                compact[24:] + "-" + compact[13:24],
			ReserveCommandID:      orgTestUUID(t),
			ActivateCommandID:     orgTestUUID(t),
			PayloadCiphertext:     []byte("payload"),
			ProvisioningExpiresAt: dbvalue.Timestamp(time.Now().Add(time.Hour)),
			ExpiresAt:             dbvalue.Timestamp(time.Now().Add(2 * time.Hour)),
			TenantID:              "test",
		}
		if _, err := q.PrepareHubSignupCompletion(ctx, params); err != nil {
			t.Fatal(err)
		}
		return params
	}

	replaced := issue("replaced", "first")
	opens("fresh", replaced)
	replacement := issue("replaced", "second")
	refuses("replaced", replaced)
	opens("replacement", replacement)

	expired := issue("expired", "token")
	if _, err := tx.Exec(ctx, `
		UPDATE vetchium.hub_signup_requests
		SET created_at = now() - interval '2 hours',
		    expires_at = now() - interval '1 hour'
		WHERE token_hash = $1`, expired.hash,
	); err != nil {
		t.Fatal(err)
	}
	refuses("expired", expired)

	signup := issue("completed", "token")
	operation := prepare(signup)
	opens("prepared", signup)
	if _, err := q.MarkHubSignupCompletionReserved(
		ctx, sqlc.MarkHubSignupCompletionReservedParams{
			OperationID:      operation.OperationID,
			ReserveCommandID: operation.ReserveCommandID,
			TenantID:         "test", Source: "test",
		},
	); err != nil {
		t.Fatal(err)
	}
	opens("reserved", signup)
	if _, err := q.CreateProvisioningHubUser(
		ctx, sqlc.CreateProvisioningHubUserParams{
			OperationID: operation.OperationID, EmailAddress: signup.email,
			DisplayName: "Asha", PasswordHash: "hash",
			PreferredLanguage: "en-US", ResidentCountry: "SG",
			DefaultHubPlanOid: string(subscriptionspec.DefaultPlan),
			TenantID:          "test", Source: "test",
		},
	); err != nil {
		t.Fatal(err)
	}
	opens("local_created", signup)
	if _, err := q.CompleteProvisioningHubUser(
		ctx, sqlc.CompleteProvisioningHubUserParams{
			OperationID: operation.OperationID, TenantID: "test", Source: "test",
		},
	); err != nil {
		t.Fatal(err)
	}
	refuses("completed", signup)

	failed := issue("failed", "token")
	failedOperation := prepare(failed)
	if _, err := q.FailHubSignupCompletionRegisteredElsewhere(
		ctx, sqlc.FailHubSignupCompletionRegisteredElsewhereParams{
			OperationID: failedOperation.OperationID, TenantID: "test",
		},
	); err != nil {
		t.Fatal(err)
	}
	refuses("failed", failed)
}
