package workers

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/hub/aliaschange"
)

func TestHubAliasCompletionAndCompensationIntegration(t *testing.T) {
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for _, test := range []struct {
		name        string
		handle      string
		downgrade   bool
		wantState   sqlc.VetchiumFederationOperationState
		wantRelease int
	}{
		{"paid claim", "wpaid000-0123456789a", false,
			sqlc.VetchiumFederationOperationStateSucceeded, 0},
		{"downgraded claim", "wfree000-0123456789a", true,
			sqlc.VetchiumFederationOperationStateFailed, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			did, err := dbvalue.NewUUIDv7(time.Now())
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				_, _ = pool.Exec(ctx, `DELETE FROM vetchium.federation_operations
                    WHERE aggregate_id = $1`, dbvalue.FormatUUID(did))
				_, _ = pool.Exec(ctx, `DELETE FROM vetchium.audit_events
                    WHERE entity_id = $1`, dbvalue.FormatUUID(did))
				_, _ = pool.Exec(ctx, `DELETE FROM vetchium.hub_users
                    WHERE hub_user_did = $1`, did)
			}()
			_, err = pool.Exec(ctx, `INSERT INTO vetchium.hub_users
                (hub_user_did, handle, email_address, email_digest,
                 display_name, password_hash, resident_country, hub_plan_oid,
                 subscription_billing_interval, subscription_anchor_at,
                 subscription_period_start, subscription_period_end)
                VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')),
                        'Alias Worker Test', 'test-hash', 'SG',
                        'hub-silver-tier', 'month', now() - interval '1 month',
                        now() - interval '1 day', now() + interval '1 month')`,
				did, test.handle,
				"alias-worker-"+dbvalue.FormatUUID(did)+"@example.com")
			if err != nil {
				t.Fatal(err)
			}
			alias := directoryspec.HubAlias("alias-worker-test")
			payload := aliaschange.Payload{
				HubUserDID:   hubspec.HubUserDID(dbvalue.FormatUUID(did)),
				ProfileAlias: &alias, ExpectedProfileVersion: 1,
			}
			payloadBytes, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			operationID, _ := dbvalue.NewUUID()
			commandID, _ := dbvalue.NewUUID()
			q := sqlc.New(pool)
			operation, err := q.CreateFederationOperation(ctx,
				sqlc.CreateFederationOperationParams{
					TenantID: "sgp", ActorType: "worker", Source: "workers",
					OperationID: operationID, CommandID: commandID,
					Kind: "hub-alias-change", TargetAuthority: "global-directory",
					AggregateID:        dbvalue.FormatUUID(did),
					OwnerPrincipalType: "hub_user",
					OwnerPrincipalID:   dbvalue.FormatUUID(did),
					IdempotencyKey:     "worker-alias-test",
					RequestDigest:      aliasChangeDigest(payloadBytes),
					PayloadBytes:       payloadBytes,
					ExpiresAt:          dbvalue.Timestamp(time.Now().Add(time.Hour)),
				})
			if err != nil {
				t.Fatal(err)
			}
			if test.downgrade {
				_, err = pool.Exec(ctx, `UPDATE vetchium.hub_users SET
                    hub_plan_oid = 'hub-free-tier',
                    subscription_billing_interval = NULL,
                    subscription_anchor_at = NULL,
                    subscription_period_start = NULL,
                    subscription_period_end = NULL,
                    profile_version = profile_version + 1
                    WHERE hub_user_did = $1`, did)
				if err != nil {
					t.Fatal(err)
				}
			}
			worker := &Worker{
				aliasChangeDB: pool, tenantID: "sgp",
				log: slog.New(slog.NewTextHandler(io.Discard, nil)),
			}
			if err := worker.finalizeAliasChange(
				ctx, sqlc.VetchiumFederationOperation(operation), payload, did,
			); err != nil {
				t.Fatal(err)
			}
			resolved, err := q.GetFederationOperation(ctx, operationID)
			if err != nil || resolved.State != test.wantState {
				t.Fatalf("alias operation = %+v, %v", resolved, err)
			}
			var storedAlias *string
			if err := pool.QueryRow(ctx, `SELECT profile_alias
                FROM vetchium.hub_users WHERE hub_user_did = $1`, did).
				Scan(&storedAlias); err != nil {
				t.Fatal(err)
			}
			if test.downgrade && storedAlias != nil ||
				!test.downgrade && (storedAlias == nil || *storedAlias != string(alias)) {
				t.Fatalf("local alias = %v", storedAlias)
			}
			var releaseCount int
			if err := pool.QueryRow(ctx, `SELECT count(*)
                FROM vetchium.federation_operations
                WHERE aggregate_id = $1 AND kind = 'hub-alias-release'`,
				dbvalue.FormatUUID(did)).Scan(&releaseCount); err != nil ||
				releaseCount != test.wantRelease {
				t.Fatalf("conditional releases = %d, %v", releaseCount, err)
			}
		})
	}
}
