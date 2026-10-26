package workers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	federationspec "github.com/vetchium/src/typespec/federation"

	"backend/internal/dbvalue"
)

// An interview that started while unanswered leaves the applicant's pending
// actions on the next refresh, without touching what the Org sees
// (HP-HUB-007).
func TestRefreshHubApplicationsDropsPassedInterviewResponse(t *testing.T) {
	owner, app := integrationPools(t)
	w := newRetentionWorld(t, owner)
	ctx := context.Background()
	id, applicantDID := w.application(t, 1, "in_pipeline", 5, 0)
	if _, err := owner.Exec(ctx, `UPDATE vetchium.org_applications
        SET hub_refresh_at = now() - interval '1 minute'
        WHERE org_application_id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.Exec(ctx, `UPDATE vetchium.org_interviews
        SET interview_state = 'scheduled', applicant_response = 'pending',
            ended_at = NULL, starts_at = now() - interval '1 minute'
        WHERE org_application_id = $1`, id); err != nil {
		t.Fatal(err)
	}
	updatedBefore := w.scalar(t, `SELECT updated_at::text
        FROM vetchium.org_applications WHERE org_application_id = $1`, id)

	n, err := refreshBatch(ctx, app, "sgp", "")
	if err != nil || n < 1 {
		t.Fatalf("refreshBatch = %d, %v", n, err)
	}
	if got := w.scalar(t, `SELECT (version = 2 AND hub_refresh_at IS NULL
            AND updated_at::text = $2)::text
        FROM vetchium.org_applications WHERE org_application_id = $1`,
		id, updatedBefore); got != "true" {
		t.Fatalf("version bumped, refresh cleared, updated_at kept = %s", got)
	}
	entity := dbvalue.FormatUUID(w.orgDID) + ":1:1"
	payload := w.scalar(t, `SELECT convert_from(payload_bytes, 'UTF8')
        FROM vetchium.federation_outbox
        WHERE aggregate_id = $1 AND aggregate_version = 2
          AND destination_principal_did = $2`, entity, applicantDID)
	var projected federationspec.HubApplicationChangedPayload
	if err := json.Unmarshal([]byte(payload), &projected); err != nil ||
		len(projected.PendingActions) != 0 || projected.Notice != "" {
		t.Fatalf("projection payload = %s", payload)
	}
	if got := w.scalar(t, `SELECT count(*)::text FROM vetchium.audit_events
        WHERE action = 'org.application.hub-projection-refreshed'
          AND entity_id = $1`, entity); got != "1" {
		t.Fatalf("audit events = %s", got)
	}
	// Nothing is due any more.
	if n, err := refreshBatch(ctx, app, "sgp", ""); err != nil || n != 0 {
		t.Fatalf("second refresh = %d, %v", n, err)
	}
}

// An offer with under a day left is announced once; one given a day to
// answer, and one with more time left, are not.
func TestRefreshHubApplicationsAnnouncesExpiringOffersOnce(t *testing.T) {
	owner, app := integrationPools(t)
	w := newRetentionWorld(t, owner)
	ctx := context.Background()
	type offer struct {
		extendedAgo, respondIn string
		announced              bool
	}
	cases := map[int]offer{
		1: {"3 days", "12 hours", true},
		2: {"1 hour", "23 hours", false}, // given exactly a day
		3: {"1 hour", "47 hours", false}, // more than a day left
		4: {"3 days", "-1 hour", false},  // already past
	}
	ids := map[int]pgtype.UUID{}
	for number, c := range cases {
		id, _ := w.application(t, number, "offered", 1, 0)
		ids[number] = id
		if _, err := owner.Exec(ctx, `DELETE FROM vetchium.org_application_offers
            WHERE org_application_id = $1`, id); err != nil {
			t.Fatal(err)
		}
		if _, err := owner.Exec(ctx, `WITH letter AS (
                INSERT INTO vetchium.org_offer_letter_objects (object_id,
                    org_did, byte_size, content_sha256, state)
                VALUES (gen_random_uuid(), $2, 10, sha256('l'::bytea), 'active')
                RETURNING object_id
            )
            INSERT INTO vetchium.org_application_offers (
                org_application_offer_id, org_application_id, offer_number,
                letter_object_id, extended_at, respond_by)
            SELECT gen_random_uuid(), $1, 1, object_id,
                now() - $3::interval,
                CASE WHEN $4::interval < interval '0' THEN now() - interval '1 second'
                     ELSE now() + $4::interval END
            FROM letter`, id, w.orgDID, c.extendedAgo, c.respondIn); err != nil {
			// A past deadline needs extended_at before it; the check
			// constraint holds because extended_at is days earlier.
			t.Fatal(err)
		}
	}
	if n, err := refreshBatch(ctx, app, "sgp",
		federationspec.NoticeOfferExpiring); err != nil || n < 1 {
		t.Fatalf("refreshBatch = %d, %v", n, err)
	}
	for number, c := range cases {
		notified := w.scalar(t, `SELECT (expiring_notified_at IS NOT NULL)::text
            FROM vetchium.org_application_offers WHERE org_application_id = $1`,
			ids[number])
		if (notified == "true") != c.announced {
			t.Errorf("offer %d announced = %s, want %v", number, notified, c.announced)
		}
	}
	entity := dbvalue.FormatUUID(w.orgDID) + ":1:1"
	if got := w.scalar(t, `SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE aggregate_id = $1 AND aggregate_version = 2
          AND convert_from(payload_bytes, 'UTF8') LIKE '%"notice":"offer_expiring"%'`,
		entity); got != "1" {
		t.Fatalf("expiring events = %s", got)
	}
	// A second run announces nothing again.
	if n, err := refreshBatch(ctx, app, "sgp",
		federationspec.NoticeOfferExpiring); err != nil || n != 0 {
		t.Fatalf("second run = %d, %v", n, err)
	}
}
