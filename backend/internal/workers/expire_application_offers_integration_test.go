package workers

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	federationspec "github.com/vetchium/src/typespec/federation"

	"backend/internal/dbvalue"
)

// The stack's own workers share the database and may expire the offer
// first; either way the outcome below must hold exactly once.
func TestExpireApplicationOffersIntegration(t *testing.T) {
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SET ROLE vetchium_app")
		return err
	}
	app, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()

	newID := func() pgtype.UUID {
		id, err := dbvalue.NewUUIDv7(time.Now())
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	orgDID, userID, openingID, stageID := newID(), newID(), newID(), newID()
	due, open := newID(), newID()
	text := dbvalue.FormatUUID(orgDID)
	defer func() {
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_outbox
            WHERE aggregate_id LIKE $1`, text+"%")
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.audit_events
            WHERE entity_id LIKE $1`, text+"%")
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.orgs WHERE org_did = $1`,
			orgDID)
	}()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO vetchium.orgs (org_did, display_name, country,
            default_language, org_state, org_plan_oid)
            VALUES ($1, 'Expiry Test', 'DE', 'de-DE', 'active',
                'org-free-tier')`, []any{orgDID}},
		{`INSERT INTO vetchium.org_users (org_user_id, org_did, email_address,
            org_user_state, preferred_language)
            VALUES ($1, $2, 'owner@expiry.example', 'active', 'de-DE')`,
			[]any{userID, orgDID}},
		{`INSERT INTO vetchium.org_domains (org_did, domain,
            verification_token, last_verified_at, last_conclusive_at,
            next_check_at)
            VALUES ($1, $2, 'abcdefghijklmnopqrstuvwxyz', now(), now(),
                now() + interval '1 day')`,
			[]any{orgDID, "expiry-" + text[len(text)-12:] + ".example"}},
		{`INSERT INTO vetchium.org_openings (org_opening_id, org_did,
            opening_number, opening_state, created_by, first_published_at,
            expires_at)
            VALUES ($1, $2, 1, 'published', $3, now(),
                now() + interval '180 days')`,
			[]any{openingID, orgDID, userID}},
		{`INSERT INTO vetchium.org_opening_contents (org_opening_id, slot,
            title, description, language, employing_country,
            work_arrangement, employment_type, positions, updated_by)
            VALUES ($1, 'live', 'Engineer', 'Build things', 'en', 'DE',
                'on_site', 'full_time', 1, $2)`,
			[]any{openingID, userID}},
		{`INSERT INTO vetchium.org_opening_stages (org_opening_stage_id,
            org_opening_id, position, name, stage_kind)
            VALUES ($1, $2, 1, 'Review', 'review')`,
			[]any{stageID, openingID}},
	} {
		if _, err := owner.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	// Application 1's offer passed its deadline; application 2's has a day
	// left.
	for number, applicant := range map[int]pgtype.UUID{1: due, 2: open} {
		deadline := "now() + interval '1 day'"
		if number == 1 {
			deadline = "now() - interval '1 second'"
		}
		if _, err := owner.Exec(ctx, `WITH applicant AS (
                INSERT INTO vetchium.org_applicants (org_applicant_id,
                    org_did, applicant_kind, hub_user_did)
                VALUES (gen_random_uuid(), $1, 'hub_user', $2)
                RETURNING org_applicant_id
            ), application AS (
                INSERT INTO vetchium.org_applications (org_application_id,
                    org_opening_id, application_number, org_applicant_id,
                    application_state, snapshot, current_stage_id,
                    offer_extended_at)
                SELECT gen_random_uuid(), $3, $4, org_applicant_id, 'offered',
                    '{"display_name":"Ada Lovelace"}'::jsonb, $5,
                    now() - interval '2 days'
                FROM applicant
                RETURNING org_application_id
            ), letter AS (
                INSERT INTO vetchium.org_offer_letter_objects (object_id,
                    org_did, byte_size, content_sha256, state)
                VALUES (gen_random_uuid(), $1, 10, sha256('letter'::bytea),
                    'active')
                RETURNING object_id
            )
            INSERT INTO vetchium.org_application_offers (
                org_application_offer_id, org_application_id, offer_number,
                letter_object_id, respond_by, extended_at)
            SELECT gen_random_uuid(), org_application_id, 1, object_id, `+
			deadline+`, now() - interval '2 days'
            FROM application, letter`,
			orgDID, applicant, openingID, number, stageID); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := expireOfferBatch(ctx, app, "sgp"); err != nil {
		t.Fatal(err)
	}
	scalar := func(sql string, args ...any) string {
		t.Helper()
		var value string
		if err := owner.QueryRow(ctx, sql, args...).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	state := func(number int) string {
		return scalar(`SELECT a.application_state::text || ':' ||
            a.version::text || ':' || o.offer_status::text || ':' ||
            (o.ended_at IS NOT NULL)::text
            FROM vetchium.org_applications AS a
            JOIN vetchium.org_application_offers AS o USING (org_application_id)
            WHERE a.org_opening_id = $1 AND a.application_number = $2`,
			openingID, number)
	}
	if got := state(1); got != "offer_declined:2:expired:true" {
		t.Fatalf("due application = %s", got)
	}
	if got := state(2); got != "offered:1:extended:false" {
		t.Fatalf("open application = %s", got)
	}
	if got := scalar(`SELECT count(*)::text
        FROM vetchium.org_application_history AS h
        JOIN vetchium.org_applications AS a USING (org_application_id)
        WHERE a.org_opening_id = $1 AND a.application_number = 1
          AND h.action = 'offer_declined' AND h.actor_kind = 'system'
          AND h.application_version = 2`, openingID); got != "1" {
		t.Fatalf("history entries = %s", got)
	}
	entity := text + ":1:1"
	if got := scalar(`SELECT count(*)::text FROM vetchium.audit_events
        WHERE action = 'org.application.offer_expired' AND entity_id = $1
          AND actor_type = 'worker' AND payload ->> 'offer_number' = '1'`,
		entity); got != "1" {
		t.Fatalf("audit events = %s", got)
	}
	payload := scalar(`SELECT convert_from(payload_bytes, 'UTF8')
        FROM vetchium.federation_outbox
        WHERE aggregate_id = $1 AND aggregate_version = 2
          AND destination_principal_did = $2`, entity, due)
	var projected federationspec.HubApplicationChangedPayload
	if err := json.Unmarshal([]byte(payload), &projected); err != nil ||
		projected.Status != "declined" ||
		len(projected.PendingActions) != 0 {
		t.Fatalf("projection payload = %s", payload)
	}
	if _, err := expireOfferBatch(ctx, app, "sgp"); err != nil {
		t.Fatal(err)
	}
	if got := scalar(`SELECT count(*)::text FROM vetchium.audit_events
        WHERE action = 'org.application.offer_expired' AND entity_id = $1`,
		entity); got != "1" || state(1) != "offer_declined:2:expired:true" {
		t.Fatalf("a second run changed the expired offer again: %s", got)
	}
}
