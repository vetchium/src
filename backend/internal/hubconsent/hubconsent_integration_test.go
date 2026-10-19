package hubconsent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
)

type fixture struct {
	owner     *pgxpool.Pool
	executor  *commands.Executor
	orgDID    pgtype.UUID
	openingID pgtype.UUID
	stageID   pgtype.UUID
	elsewhere pgtype.UUID
}

func newDID(t *testing.T) pgtype.UUID {
	t.Helper()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return did
}

// newFixture seeds an active Org with a published opening 1 whose pipeline
// has one background-check stage, and removes everything afterwards. The Org's
// tenant is usa1; commands come from sgp, which the directory says homes
// every applicant but f.elsewhere.
func newFixture(t *testing.T) *fixture {
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
	app, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	f := &fixture{
		owner: owner, orgDID: newDID(t), openingID: newDID(t),
		stageID: newDID(t), elsewhere: newDID(t),
	}
	userID := newDID(t)
	text := dbvalue.FormatUUID(f.orgDID)
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO vetchium.orgs (org_did, display_name, country,
            default_language, org_state, org_plan_oid)
            VALUES ($1, 'Consent Test', 'DE', 'de-DE', 'active',
                'org-free-tier')`, []any{f.orgDID}},
		{`INSERT INTO vetchium.org_users (org_user_id, org_did, email_address,
            org_user_state, preferred_language)
            VALUES ($1, $2, 'owner@consent.example', 'active', 'de-DE')`,
			[]any{userID, f.orgDID}},
		{`INSERT INTO vetchium.org_domains (org_did, domain,
            verification_token, last_verified_at, last_conclusive_at,
            next_check_at)
            VALUES ($1, $2, 'abcdefghijklmnopqrstuvwxyz', now(), now(),
                now() + interval '1 day')`,
			[]any{f.orgDID, "consent-" + text[len(text)-12:] + ".example"}},
		{`INSERT INTO vetchium.org_openings (org_opening_id, org_did,
            opening_number, opening_state, created_by, first_published_at,
            expires_at)
            VALUES ($1, $2, 1, 'published', $3, now(),
                now() + interval '180 days')`,
			[]any{f.openingID, f.orgDID, userID}},
		{`INSERT INTO vetchium.org_opening_contents (org_opening_id, slot,
            title, description, language, employing_country,
            work_arrangement, employment_type, positions, updated_by)
            VALUES ($1, 'live', 'Engineer', 'Build things', 'en', 'DE',
                'on_site', 'full_time', 1, $2)`,
			[]any{f.openingID, userID}},
		{`INSERT INTO vetchium.org_opening_stages (org_opening_stage_id,
            org_opening_id, position, name, stage_kind)
            VALUES ($1, $2, 1, 'Secret Screening', 'background_check')`,
			[]any{f.stageID, f.openingID}},
	} {
		if _, err := owner.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM vetchium.federation_command_ledger
             WHERE aggregate_id LIKE $1`,
			`DELETE FROM vetchium.federation_outbox WHERE aggregate_id LIKE $1`,
			`DELETE FROM vetchium.audit_events WHERE entity_id LIKE $1`,
		} {
			_, _ = owner.Exec(ctx, sql, text+"%")
		}
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.orgs WHERE org_did = $1`,
			f.orgDID)
	})
	registry := commands.NewRegistry()
	Register(registry)
	f.executor = commands.NewExecutor(commands.ExecutorConfig{
		Pool: app, TenantID: "usa1", Registry: registry, Directory: f,
	})
	return f
}

func (f *fixture) ResolvePrincipal(
	_ context.Context, request directoryspec.ResolvePrincipalRequest,
) (directoryspec.ResolvePrincipalResponse, *problem.Details, error) {
	home := directoryspec.TenantID("sgp")
	if string(request.PrincipalDID) == dbvalue.FormatUUID(f.elsewhere) {
		home = "deu"
	}
	return directoryspec.ResolvePrincipalResponse{
		PrincipalType: request.PrincipalType,
		PrincipalDID:  request.PrincipalDID, HomeTenantID: home,
		RoutingVersion: 1,
	}, nil, nil
}

// seed inserts application number for applicant in state at the stage, with
// consent request 1 for identity and drug checks in consentState.
func (f *fixture) seed(
	t *testing.T, applicant pgtype.UUID, number int, state string,
	consentState string,
) {
	t.Helper()
	ctx := context.Background()
	if _, err := f.owner.Exec(ctx, `WITH applicant AS (
            INSERT INTO vetchium.org_applicants (org_applicant_id, org_did,
                applicant_kind, hub_user_did)
            VALUES (gen_random_uuid(), $1, 'hub_user', $2)
            ON CONFLICT (org_did, hub_user_did)
                DO UPDATE SET hub_user_did = EXCLUDED.hub_user_did
            RETURNING org_applicant_id
        )
        INSERT INTO vetchium.org_applications (org_application_id,
            org_opening_id, application_number, org_applicant_id,
            application_state, snapshot, current_stage_id)
        SELECT gen_random_uuid(), $3, $4, org_applicant_id,
            $5::vetchium.org_application_state,
            '{"display_name":"Ada Lovelace"}'::jsonb, $6
        FROM applicant`,
		f.orgDID, applicant, f.openingID, number, state, f.stageID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.owner.Exec(ctx, `INSERT INTO vetchium.org_background_checks (
            org_background_check_id, org_application_id, check_number,
            org_opening_stage_id, check_types, consent_state, responded_at)
        SELECT gen_random_uuid(), a.org_application_id, 1, $3,
            ARRAY['identity', 'drug'], $4::vetchium.org_consent_state,
            CASE WHEN $4 IN ('given', 'declined') THEN now() END
        FROM vetchium.org_applications AS a
        WHERE a.org_opening_id = $1 AND a.application_number = $2`,
		f.openingID, number, f.stageID, consentState); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) answer(
	t *testing.T, kind federationspec.CommandKind, commandID, applicant pgtype.UUID,
	number, check int,
) commands.Response {
	t.Helper()
	body, err := json.Marshal(federationspec.HubBackgroundCheckConsentPayload{
		OpeningNumber:     1,
		ApplicationNumber: applications.ApplicationNumber(number),
		CheckNumber:       applications.BackgroundCheckNumber(check),
		ApplicantDID:      hub.HubUserDID(dbvalue.FormatUUID(applicant)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return f.send(t, kind, commandID, body)
}

func (f *fixture) send(
	t *testing.T, kind federationspec.CommandKind, commandID pgtype.UUID,
	body []byte,
) commands.Response {
	t.Helper()
	response, err := f.executor.Execute(context.Background(), commands.Command{
		CommandID: commandID, CorrelationID: commandID, SourceTenantID: "sgp",
		Kind: kind,
		Authority: commands.Principal{
			Type: directoryspec.PrincipalOrg, DID: f.orgDID,
		},
		AggregateID: dbvalue.FormatUUID(f.orgDID) + ":1", Payload: body,
	})
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func (f *fixture) scalar(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var value string
	if err := f.owner.QueryRow(context.Background(), sql, args...).
		Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

// state is the application's version and the request's consent state.
func (f *fixture) state(t *testing.T, number int) string {
	t.Helper()
	return f.scalar(t, `SELECT a.version::text || ':' || b.consent_state::text
        FROM vetchium.org_applications AS a
        JOIN vetchium.org_background_checks AS b USING (org_application_id)
        WHERE a.org_opening_id = $1 AND a.application_number = $2`,
		f.openingID, number)
}

func problemType(t *testing.T, response commands.Response) string {
	t.Helper()
	var body struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(response.Body, &body); err != nil {
		t.Fatal(err)
	}
	return strings.TrimPrefix(body.Type, "vetchium-problem-details/")
}

func TestHubAnswersAConsentRequestIntegration(t *testing.T) {
	f := newFixture(t)
	for index, test := range []struct {
		name  string
		kind  federationspec.CommandKind
		other federationspec.CommandKind
		state string
		event string
	}{
		{"give", federationspec.HubGiveConsentKind, federationspec.HubDeclineConsentKind,
			"2:given", "background_check_consent_given"},
		{"decline", federationspec.HubDeclineConsentKind, federationspec.HubGiveConsentKind,
			"2:declined", "background_check_consent_declined"},
	} {
		t.Run(test.name, func(t *testing.T) {
			applicant, number := newDID(t), index+1
			f.seed(t, applicant, number, "in_pipeline", "requested")
			commandID := newDID(t)
			response := f.answer(t, test.kind, commandID, applicant, number, 1)
			var result federationspec.HubBackgroundCheckConsentResult
			if response.Status != 200 ||
				json.Unmarshal(response.Body, &result) != nil ||
				int(result.ApplicationNumber) != number || result.CheckNumber != 1 {
				t.Fatalf("response = %d %s", response.Status, response.Body)
			}
			if got := f.state(t, number); got != test.state {
				t.Fatalf("state = %s, want %s", got, test.state)
			}
			if got := f.scalar(t, `SELECT count(*)::text
                FROM vetchium.org_application_history AS h
                JOIN vetchium.org_applications AS a USING (org_application_id)
                WHERE a.org_opening_id = $1 AND a.application_number = $2
                  AND h.action = $3 AND h.actor_kind = 'applicant'
                  AND h.application_version = 2
                  AND h.org_opening_stage_id = $4`,
				f.openingID, number, test.event, f.stageID); got != "1" {
				t.Fatalf("history entries = %s", got)
			}
			entity := fmt.Sprintf("%s:1:%d", dbvalue.FormatUUID(f.orgDID), number)
			if got := f.scalar(t, `SELECT payload::text
                FROM vetchium.audit_events
                WHERE action = $1 AND entity_id = $2
                  AND actor_type = 'hub_user' AND actor_id = $3`,
				"org.application."+test.event, entity,
				dbvalue.FormatUUID(applicant)); !strings.Contains(got, `"check_number": 1`) {
				t.Fatalf("audit payload = %s", got)
			}
			payload := f.scalar(t, `SELECT convert_from(payload_bytes, 'UTF8')
                FROM vetchium.federation_outbox
                WHERE aggregate_id = $1 AND aggregate_version = 2
                  AND destination_principal_did = $2`, entity, applicant)
			var projected federationspec.HubApplicationChangedPayload
			if err := json.Unmarshal([]byte(payload), &projected); err != nil ||
				len(projected.PendingActions) != 0 ||
				strings.Contains(payload, "Secret Screening") ||
				strings.Contains(payload, "identity") {
				t.Fatalf("projection payload = %s", payload)
			}
			replayed := f.answer(t, test.kind, commandID, applicant, number, 1)
			if replayed.Status != 200 || string(replayed.Body) != string(response.Body) {
				t.Fatalf("replay = %d %s", replayed.Status, replayed.Body)
			}
			if got := f.state(t, number); got != test.state {
				t.Fatalf("replay changed the state: %s", got)
			}
			for _, kind := range []federationspec.CommandKind{test.kind, test.other} {
				again := f.answer(t, kind, newDID(t), applicant, number, 1)
				if again.Status != 409 ||
					problemType(t, again) != "hub-application-state-conflict" {
					t.Fatalf("second answer = %d %s", again.Status, again.Body)
				}
			}
		})
	}
}

func TestHubConsentRefusalsIntegration(t *testing.T) {
	f := newFixture(t)
	owner, other := newDID(t), newDID(t)
	f.seed(t, owner, 1, "in_pipeline", "requested")
	f.seed(t, newDID(t), 2, "in_pipeline", "requested")
	ended, left, offered := newDID(t), newDID(t), newDID(t)
	f.seed(t, ended, 3, "in_pipeline", "ended")
	f.seed(t, left, 4, "withdrawn", "requested")
	f.seed(t, offered, 5, "offered", "requested")
	give := federationspec.HubGiveConsentKind
	for name, test := range map[string]struct {
		response commands.Response
		want     string
	}{
		"another request number": {
			f.answer(t, give, newDID(t), owner, 1, 2), "hub-application-not-found",
		},
		"another applicant": {
			f.answer(t, give, newDID(t), other, 2, 1), "hub-application-not-found",
		},
		"unknown application": {
			f.answer(t, give, newDID(t), owner, 9, 1), "hub-application-not-found",
		},
		"ended request": {
			f.answer(t, give, newDID(t), ended, 3, 1), "hub-application-state-conflict",
		},
		"application left the pipeline": {
			f.answer(t, give, newDID(t), left, 4, 1), "hub-application-state-conflict",
		},
		"homed at another tenant": {
			f.answer(t, give, newDID(t), f.elsewhere, 1, 1), "federation-initiator-mismatch",
		},
		"zero request number": {
			f.answer(t, give, newDID(t), owner, 1, 0), "validation-failed",
		},
	} {
		if problemType(t, test.response) != test.want {
			t.Errorf("%s: response = %d %s", name, test.response.Status,
				test.response.Body)
		}
	}
	// An offered candidacy may still be asked and may still answer.
	if response := f.answer(t, give, newDID(t), offered, 5, 1); response.Status != 200 {
		t.Errorf("offered candidacy: %d %s", response.Status, response.Body)
	}
	applicantText := dbvalue.FormatUUID(owner)
	malformed := f.send(t, give, newDID(t), []byte(
		`{"opening_number":1,"application_number":1,"check_number":1,`+
			`"applicant_did":"`+applicantText+`","note":"x"}`))
	if malformed.Status != 400 || problemType(t, malformed) != "validation-failed" {
		t.Errorf("an unknown field: %d %s", malformed.Status, malformed.Body)
	}
	if got := f.state(t, 1); got != "1:requested" {
		t.Fatalf("refusals changed the application: %s", got)
	}
}

func TestEndPendingConsentsEndsOnlyRequestedIntegration(t *testing.T) {
	f := newFixture(t)
	for number, state := range []string{"requested", "given", "declined", "ended"} {
		f.seed(t, newDID(t), number+1, "in_pipeline", state)
	}
	if got := f.scalar(t, `SELECT vetchium.end_pending_consents(
            ARRAY(SELECT org_application_id FROM vetchium.org_applications
                  WHERE org_opening_id = $1))::text`, f.openingID); got != "1" {
		t.Fatalf("ended %s requests, want 1", got)
	}
	if got := f.scalar(t, `SELECT string_agg(b.consent_state::text, ',' ORDER BY a.application_number)
        FROM vetchium.org_background_checks AS b
        JOIN vetchium.org_applications AS a USING (org_application_id)
        WHERE a.org_opening_id = $1`, f.openingID); got != "ended,given,declined,ended" {
		t.Fatalf("states = %s", got)
	}
}
