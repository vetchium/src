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

func TestRecordHubSentChatRequestIntegration(t *testing.T) {
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
	agencyDID, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid,
         subscription_billing_interval, subscription_anchor_at,
         subscription_period_start, subscription_period_end, profile_alias)
        VALUES ($1, 'pointer1-0123456789a', $2, sha256(convert_to($2, 'UTF8')),
                'Pointer Test', 'test-hash', 'SG', 'hub-silver-tier', 'month',
                now() - interval '1 month', now() - interval '1 day',
                now() + interval '1 month', 'pointer-sent-alias')`,
		did, "pointer-sent-"+dbvalue.FormatUUID(did)+"@example.com"); err != nil {
		t.Fatal(err)
	}
	record := func(requestID, sentAt string) int64 {
		t.Helper()
		rows, err := q.RecordHubSentChatRequest(ctx, sqlc.RecordHubSentChatRequestParams{
			ContactID: contactID, HubUserDid: did, AgencyOrgDid: agencyDID,
			AgencyDisplayName: "Talent Scouts", AgencyDomain: "scouts.example",
			Request: []byte(`{"request_id":"` + requestID + `","direction":"to_agency",
                "state":"pending","sent_at":"` + sentAt + `"}`),
			TenantID: "sgp",
		})
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	if rows := record("a0000000-0000-7000-8000-000000000001", "2026-01-02T00:00:00Z"); rows != 1 {
		t.Fatalf("first record changed %d pointers", rows)
	}
	// A replay, and an older request, change nothing.
	if rows := record("a0000000-0000-7000-8000-000000000001", "2026-01-02T00:00:00Z"); rows != 0 {
		t.Fatalf("replay changed %d pointers", rows)
	}
	if rows := record("a0000000-0000-7000-8000-000000000000", "2026-01-01T00:00:00Z"); rows != 0 {
		t.Fatalf("older request changed %d pointers", rows)
	}
	if rows := record("a0000000-0000-7000-8000-000000000002", "2026-01-03T00:00:00Z"); rows != 1 {
		t.Fatalf("newer request changed %d pointers", rows)
	}

	var line string
	if err := tx.QueryRow(ctx, `SELECT concat_ws(' ', has_conversation,
            has_request, request ->> 'request_id', pointer_version,
            agency_domain, last_activity_at = '2026-01-03T00:00:00Z')
        FROM vetchium.hub_agency_pointers WHERE contact_id = $1`,
		contactID).Scan(&line); err != nil {
		t.Fatal(err)
	}
	if line != "f t a0000000-0000-7000-8000-000000000002 1 scouts.example t" {
		t.Fatalf("pointer = %q", line)
	}
	var audits []string
	rows, err := tx.Query(ctx, `SELECT action || ' ' || (payload ->> 'request_id')
        FROM vetchium.audit_events
        WHERE subject_hub_user_did = $1
        ORDER BY audit_event_id`, did)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		audits = append(audits, line)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(audits) != 2 ||
		audits[0] != "hub.agency-chat-request.sent a0000000-0000-7000-8000-000000000001" ||
		audits[1] != "hub.agency-chat-request.sent a0000000-0000-7000-8000-000000000002" {
		t.Fatalf("audit events = %q", audits)
	}
}
