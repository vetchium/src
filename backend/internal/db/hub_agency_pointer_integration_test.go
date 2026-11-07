package db

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

func TestSetHubAgencyPointerAnsweredRequestIntegration(t *testing.T) {
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
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)

	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	contactID, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid,
         subscription_billing_interval, subscription_anchor_at,
         subscription_period_start, subscription_period_end, profile_alias)
        VALUES ($1, 'pointer0-0123456789a', $2, sha256(convert_to($2, 'UTF8')),
                'Pointer Test', 'test-hash', 'SG', 'hub-silver-tier', 'month',
                now() - interval '1 month', now() - interval '1 day',
                now() + interval '1 month', 'pointer-test-alias')`,
		did, "pointer-test-"+dbvalue.FormatUUID(did)+"@example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO vetchium.hub_agency_pointers
        (contact_id, hub_user_did, agency_org_did, has_request, request,
         pointer_version)
        VALUES ($1, $2, gen_random_uuid(), true, jsonb_build_object(
            'request_id', 'a0000000-0000-7000-8000-000000000001',
            'state', 'pending', 'direction', 'to_hub_user'), 4)`,
		contactID, did); err != nil {
		t.Fatal(err)
	}

	answer := func(request string) int64 {
		t.Helper()
		rows, err := q.SetHubAgencyPointerAnsweredRequest(ctx,
			sqlc.SetHubAgencyPointerAnsweredRequestParams{
				Request: []byte(request), Accepted: true,
				ContactID: contactID, HubUserDid: did, TenantID: "sgp",
			})
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	if rows := answer(`{"request_id":"a0000000-0000-7000-8000-000000000002",
        "state":"accepted","direction":"to_hub_user"}`); rows != 0 {
		t.Fatalf("another request changed %d pointers", rows)
	}
	accepted := `{"request_id":"a0000000-0000-7000-8000-000000000001",
        "state":"accepted","direction":"to_hub_user"}`
	if rows := answer(accepted); rows != 1 {
		t.Fatalf("answer changed %d pointers", rows)
	}
	// A replay finds the answer already recorded and claims no change.
	if rows := answer(accepted); rows != 0 {
		t.Fatalf("replay changed %d pointers", rows)
	}

	var hasConversation bool
	var state string
	var version int32
	if err := tx.QueryRow(ctx, `SELECT has_conversation, request ->> 'state',
            pointer_version
        FROM vetchium.hub_agency_pointers WHERE contact_id = $1`,
		contactID).Scan(&hasConversation, &state, &version); err != nil {
		t.Fatal(err)
	}
	if !hasConversation || state != "accepted" || version != 4 {
		t.Fatalf("pointer = %v %q version %d", hasConversation, state, version)
	}
	var audits []string
	rows, err := tx.Query(ctx, `SELECT action || ' ' || actor_type || ' ' ||
            entity_id || ' ' || payload::text
        FROM vetchium.audit_events
        WHERE subject_hub_user_did = $1
        ORDER BY audit_event_id`, did)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		audits = append(audits, line)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	contact := dbvalue.FormatUUID(contactID)
	if len(audits) != 1 || !strings.HasPrefix(audits[0],
		"hub.agency-chat-request.answered hub_user "+contact+" ") ||
		!strings.Contains(audits[0], `"state": "accepted"`) ||
		!strings.Contains(audits[0], `"request_id": "a0000000-0000-7000-8000-000000000001"`) {
		t.Fatalf("audit events = %q", audits)
	}
}
