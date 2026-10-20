package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	federationspec "github.com/vetchium/src/typespec/federation"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// integrationPools opens the table owner, which seeds and inspects, and the
// application role, which the code under test runs as so the audit trigger
// applies to it.
func integrationPools(t *testing.T) (owner, app *pgxpool.Pool) {
	t.Helper()
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SET ROLE vetchium_app")
		return err
	}
	app, err = pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	return owner, app
}

type retentionWorld struct {
	owner     *pgxpool.Pool
	orgDID    pgtype.UUID
	userID    pgtype.UUID
	openingID pgtype.UUID
	stageID   pgtype.UUID
}

func newRetentionWorld(t *testing.T, owner *pgxpool.Pool) *retentionWorld {
	t.Helper()
	ctx := context.Background()
	newID := func() pgtype.UUID {
		id, err := dbvalue.NewUUIDv7(time.Now())
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	w := &retentionWorld{
		owner: owner, orgDID: newID(), userID: newID(), openingID: newID(),
		stageID: newID(),
	}
	text := dbvalue.FormatUUID(w.orgDID)
	t.Cleanup(func() {
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_outbox
            WHERE aggregate_id LIKE $1`, text+"%")
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.audit_events
            WHERE entity_id LIKE $1`, text+"%")
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.org_offer_letter_objects
            WHERE org_did = $1`, w.orgDID)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.orgs WHERE org_did = $1`,
			w.orgDID)
	})
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO vetchium.orgs (org_did, display_name, country,
            default_language, org_state, org_plan_oid)
            VALUES ($1, 'Retention Test', 'DE', 'de-DE', 'active',
                'org-free-tier')`, []any{w.orgDID}},
		{`INSERT INTO vetchium.org_users (org_user_id, org_did, email_address,
            org_user_state, preferred_language)
            VALUES ($1, $2, 'owner@retention.example', 'active', 'de-DE')`,
			[]any{w.userID, w.orgDID}},
		{`INSERT INTO vetchium.org_domains (org_did, domain,
            verification_token, last_verified_at, last_conclusive_at,
            next_check_at)
            VALUES ($1, $2, 'abcdefghijklmnopqrstuvwxyz', now(), now(),
                now() + interval '1 day')`,
			[]any{w.orgDID, "retention-" + text[len(text)-12:] + ".example"}},
		{`INSERT INTO vetchium.org_openings (org_opening_id, org_did,
            opening_number, opening_state, created_by, first_published_at,
            expires_at)
            VALUES ($1, $2, 1, 'published', $3, now(),
                now() + interval '180 days')`,
			[]any{w.openingID, w.orgDID, w.userID}},
		{`INSERT INTO vetchium.org_opening_contents (org_opening_id, slot,
            title, description, language, employing_country,
            work_arrangement, employment_type, positions, updated_by)
            VALUES ($1, 'live', 'Engineer', 'Build things', 'en', 'DE',
                'on_site', 'full_time', 1, $2)`,
			[]any{w.openingID, w.userID}},
		{`INSERT INTO vetchium.org_opening_stages (org_opening_stage_id,
            org_opening_id, position, name, stage_kind)
            VALUES ($1, $2, 1, 'Review', 'review')`,
			[]any{w.stageID, w.openingID}},
	} {
		if _, err := owner.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	return w
}

// application seeds an application in state whose last change and joining
// date are the given days ago, with one of every kind of personal row.
func (w *retentionWorld) application(
	t *testing.T, number int, state string, updatedDaysAgo int,
	joinedDaysAgo int,
) (applicationID, applicantDID pgtype.UUID) {
	t.Helper()
	ctx := context.Background()
	applicantDID, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	joined := "NULL"
	recorded := "NULL"
	if state == "joined" {
		joined = fmt.Sprintf("current_date - %d", joinedDaysAgo)
		recorded = "now() - interval '400 days'"
	}
	if err := w.owner.QueryRow(ctx, fmt.Sprintf(`WITH applicant AS (
            INSERT INTO vetchium.org_applicants (org_applicant_id, org_did,
                applicant_kind, hub_user_did)
            VALUES (gen_random_uuid(), $1, 'hub_user', $2)
            RETURNING org_applicant_id
        )
        INSERT INTO vetchium.org_applications (org_application_id,
            org_opening_id, application_number, org_applicant_id,
            application_state, snapshot, cover_note, joined_on,
            joined_recorded_at, created_at, updated_at, current_stage_id)
        SELECT gen_random_uuid(), $3, $4, org_applicant_id,
            $5::text::vetchium.org_application_state,
            '{"display_name":"Ada Lovelace","resident_country":"GB"}'::jsonb,
            'Please hire me', %s, %s,
            now() - make_interval(days => $6 + 30),
            now() - make_interval(days => $6),
            CASE WHEN $5::text IN ('in_pipeline', 'offered', 'offer_accepted')
                 THEN $7::uuid END
        FROM applicant
        RETURNING org_application_id`, joined, recorded),
		w.orgDID, applicantDID, w.openingID, number, state, updatedDaysAgo,
		w.stageID,
	).Scan(&applicationID); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO vetchium.org_interviews (org_interview_id,
            org_application_id, interview_number, org_opening_stage_id,
            starts_at, duration_minutes, interview_mode, location,
            interview_state, applicant_response, ended_at, scheduled_by)
         VALUES ($1, $2, 1, $3, now() - interval '500 days', 30, 'in_person',
            'Room 1', 'completed', 'accepted', now() - interval '500 days',
            $4)`,
	} {
		interviewID, _ := dbvalue.NewUUIDv7(time.Now())
		if _, err := w.owner.Exec(ctx, sql, interviewID, applicationID,
			w.stageID, w.userID); err != nil {
			t.Fatal(err)
		}
		if _, err := w.owner.Exec(ctx, `INSERT INTO
            vetchium.org_interview_interviewers (org_interview_id, org_user_id)
            VALUES ($1, $2)`, interviewID, w.userID); err != nil {
			t.Fatal(err)
		}
		if _, err := w.owner.Exec(ctx, `INSERT INTO
            vetchium.org_interview_feedback (org_interview_id, org_user_id,
                recommendation, notes)
            VALUES ($1, $2, 'yes', 'Strong candidate')`, interviewID,
			w.userID); err != nil {
			t.Fatal(err)
		}
		// A provider's interviewer and feedback are applicant content too.
		if _, err := w.owner.Exec(ctx, `INSERT INTO
            vetchium.org_provider_interview_interviewers
            (org_interview_id, interviewer_email)
            VALUES ($1, 'provider-interviewer@agency.test')`,
			interviewID); err != nil {
			t.Fatal(err)
		}
		if _, err := w.owner.Exec(ctx, `INSERT INTO
            vetchium.org_provider_interview_feedback (org_interview_id,
                interviewer_email, recommendation, notes)
            VALUES ($1, 'provider-interviewer@agency.test', 'no',
                'Provider notes')`, interviewID); err != nil {
			t.Fatal(err)
		}
	}
	for _, statement := range []string{
		`INSERT INTO vetchium.org_application_assessments (org_application_id,
            org_opening_stage_id, outcome, score, notes, report_url)
         VALUES ($1, $2, 'pass', 90, 'Good', 'https://reports.example/1')`,
		`WITH check_row AS (
            INSERT INTO vetchium.org_background_checks (
                org_background_check_id, org_application_id, check_number,
                org_opening_stage_id, check_types, consent_state,
                responded_at)
            VALUES (gen_random_uuid(), $1, 1, $2, ARRAY['identity'], 'given',
                now())
            RETURNING org_background_check_id
         )
         INSERT INTO vetchium.org_background_check_results (
            org_background_check_id, check_type, outcome, notes, report_url)
         SELECT org_background_check_id, 'identity', 'clear', 'Verified',
            'https://reports.example/2' FROM check_row`,
	} {
		if _, err := w.owner.Exec(ctx, statement, applicationID, w.stageID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := w.owner.Exec(ctx, `WITH letter AS (
            INSERT INTO vetchium.org_offer_letter_objects (object_id, org_did,
                byte_size, content_sha256, state)
            VALUES (gen_random_uuid(), $2, 10, sha256('letter'::bytea),
                'active')
            RETURNING object_id
        )
        INSERT INTO vetchium.org_application_offers (
            org_application_offer_id, org_application_id, offer_number,
            letter_object_id, respond_by, extended_at, offer_status, ended_at)
        SELECT gen_random_uuid(), $1, 1, object_id,
            now() - interval '899 days', now() - interval '900 days',
            'accepted', now() - interval '899 days'
        FROM letter`, applicationID, w.orgDID); err != nil {
		t.Fatal(err)
	}
	return applicationID, applicantDID
}

func (w *retentionWorld) scalar(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var value string
	if err := w.owner.QueryRow(context.Background(), sql, args...).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

// The selection and its boundaries (HP-RET-001): 365 days after a terminal
// state, and for joined 365 days after joined_on; nothing that is not
// terminal, whatever its age.
func TestRetainApplicationsSelectionAndBoundaries(t *testing.T) {
	owner, app := integrationPools(t)
	w := newRetentionWorld(t, owner)
	type fixture struct {
		name    string
		state   string
		updated int
		joined  int
		removed bool
	}
	fixtures := []fixture{
		{"withdrawn just before", "withdrawn", 364, 0, false},
		{"withdrawn just after", "withdrawn", 366, 0, true},
		{"not progressing old", "not_progressing", 700, 0, true},
		{"did not join old", "did_not_join", 700, 0, true},
		{"offer declined old", "offer_declined", 700, 0, true},
		{"offer declined recent", "offer_declined", 10, 0, false},
		{"in pipeline ancient", "submitted", 2000, 0, false},
		// updated_at is recent: only joined_on counts for joined.
		{"joined just before", "joined", 1, 364, false},
		{"joined just after", "joined", 1, 366, true},
	}
	ids := map[string]pgtype.UUID{}
	for index, f := range fixtures {
		id, _ := w.application(t, index+1, f.state, f.updated, f.joined)
		ids[f.name] = id
	}
	ctx := context.Background()
	due := map[pgtype.UUID]bool{}
	list, err := sqlc.New(app).ListOrgApplicationsDueForRetention(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range list {
		due[id] = true
	}
	for _, f := range fixtures {
		if due[ids[f.name]] != f.removed {
			t.Errorf("%s: listed as due = %v, want %v", f.name,
				due[ids[f.name]], f.removed)
		}
	}
	for _, f := range fixtures {
		done, err := retainApplication(ctx, app, "sgp", ids[f.name])
		if err != nil {
			t.Fatalf("%s: %v", f.name, err)
		}
		if done != f.removed {
			t.Errorf("%s: removed = %v, want %v", f.name, done, f.removed)
		}
	}
}

func TestRetainApplicationDeletesPersonalDataAndKeepsFacts(t *testing.T) {
	owner, app := integrationPools(t)
	w := newRetentionWorld(t, owner)
	ctx := context.Background()
	id, applicantDID := w.application(t, 1, "not_progressing", 400, 0)
	other, _ := w.application(t, 2, "not_progressing", 5, 0)
	letterID := w.scalar(t, `SELECT letter_object_id::text
        FROM vetchium.org_application_offers WHERE org_application_id = $1`, id)

	done, err := retainApplication(ctx, app, "sgp", id)
	if err != nil || !done {
		t.Fatalf("retainApplication = %v, %v", done, err)
	}
	if got := w.scalar(t, `SELECT (removed_at IS NOT NULL AND cover_note IS NULL
            AND snapshot = '{"display_name":"Removed applicant"}'::jsonb
            AND version = 2 AND application_state = 'not_progressing'
            AND hub_refresh_at IS NULL AND application_number = 1)::text
        FROM vetchium.org_applications WHERE org_application_id = $1`,
		id); got != "true" {
		t.Fatalf("application row kept facts and cleared data = %s", got)
	}
	for table, query := range map[string]string{
		"org_interviews": `SELECT count(*)::text FROM vetchium.org_interviews
            WHERE org_application_id = $1`,
		"org_application_assessments": `SELECT count(*)::text
            FROM vetchium.org_application_assessments
            WHERE org_application_id = $1`,
		"org_background_checks": `SELECT count(*)::text
            FROM vetchium.org_background_checks WHERE org_application_id = $1`,
		"org_application_offers": `SELECT count(*)::text
            FROM vetchium.org_application_offers WHERE org_application_id = $1`,
		"org_interview_interviewers": `SELECT count(*)::text
            FROM vetchium.org_interview_interviewers
            JOIN vetchium.org_interviews USING (org_interview_id)
            WHERE org_application_id = $1`,
		"org_interview_feedback": `SELECT count(*)::text
            FROM vetchium.org_interview_feedback
            JOIN vetchium.org_interviews USING (org_interview_id)
            WHERE org_application_id = $1`,
		"org_provider_interview_interviewers": `SELECT count(*)::text
            FROM vetchium.org_provider_interview_interviewers
            JOIN vetchium.org_interviews USING (org_interview_id)
            WHERE org_application_id = $1`,
		"org_provider_interview_feedback": `SELECT count(*)::text
            FROM vetchium.org_provider_interview_feedback
            JOIN vetchium.org_interviews USING (org_interview_id)
            WHERE org_application_id = $1`,
		"org_background_check_results": `SELECT count(*)::text
            FROM vetchium.org_background_check_results
            JOIN vetchium.org_background_checks USING (org_background_check_id)
            WHERE org_application_id = $1`,
	} {
		if got := w.scalar(t, query, id); got != "0" {
			t.Errorf("%s rows after removal = %s", table, got)
		}
	}
	// The kept applicant reference and the other application are untouched.
	if got := w.scalar(t, `SELECT count(*)::text FROM vetchium.org_applicants
        WHERE hub_user_did = $1`, applicantDID); got != "1" {
		t.Fatalf("applicant rows = %s", got)
	}
	if got := w.scalar(t, `SELECT (removed_at IS NULL AND version = 1 AND
            cover_note IS NOT NULL)::text
        FROM vetchium.org_applications WHERE org_application_id = $1`,
		other); got != "true" {
		t.Fatalf("another application changed: %s", got)
	}
	// The letter bytes go through the deletion queue; the row stays until
	// the object store confirms.
	if got := w.scalar(t, `SELECT (state = 'pending_delete'
            AND delete_requested_at IS NOT NULL)::text
        FROM vetchium.org_offer_letter_objects WHERE object_id = $1::uuid`,
		letterID); got != "true" {
		t.Fatalf("letter not queued for deletion: %s", got)
	}
	if got := w.scalar(t, `SELECT count(*)::text
        FROM vetchium.org_application_history
        WHERE org_application_id = $1 AND action = 'removed'
          AND actor_kind = 'system' AND application_version = 2`, id); got != "1" {
		t.Fatalf("history entries = %s", got)
	}
	entity := dbvalue.FormatUUID(w.orgDID) + ":1:1"
	payload := w.scalar(t, `SELECT payload::text FROM vetchium.audit_events
        WHERE action = 'org.application.removed' AND entity_id = $1
          AND actor_type = 'worker'`, entity)
	var audited map[string]any
	if err := json.Unmarshal([]byte(payload), &audited); err != nil ||
		audited["interviews"] != float64(1) || audited["offers"] != float64(1) {
		t.Fatalf("audit payload = %s", payload)
	}
	for _, secret := range []string{"Ada", "Lovelace", "Strong candidate",
		"Please hire me", "Verified", "reports.example"} {
		if got := w.scalar(t, `SELECT count(*)::text FROM vetchium.audit_events
            WHERE entity_id = $1 AND payload::text LIKE '%' || $2 || '%'`,
			entity, secret); got != "0" {
			t.Errorf("audit payload holds %q", secret)
		}
	}
	// The Hub projection is deleted through the outbox.
	removal := w.scalar(t, `SELECT convert_from(payload_bytes, 'UTF8')
        FROM vetchium.federation_outbox
        WHERE aggregate_id = $1 AND aggregate_version = 2
          AND kind = 'hub-application-removed'
          AND destination_principal_did = $2`, entity, applicantDID)
	var event federationspec.HubApplicationRemovedPayload
	if err := json.Unmarshal([]byte(removal), &event); err != nil ||
		len(event.Validate()) > 0 ||
		event.ApplicationNumber != 1 || event.OpeningNumber != 1 {
		t.Fatalf("removal payload = %s", removal)
	}

	// A second run finds nothing to do and changes nothing.
	done, err = retainApplication(ctx, app, "sgp", id)
	if err != nil || done {
		t.Fatalf("second run = %v, %v", done, err)
	}
	if got := w.scalar(t, `SELECT count(*)::text FROM vetchium.audit_events
        WHERE action = 'org.application.removed' AND entity_id = $1`,
		entity); got != "1" {
		t.Fatalf("audit events after a second run = %s", got)
	}
}
