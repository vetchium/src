package hubinterview

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
// has one interview stage, and removes everything afterwards. The Org's
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
            VALUES ($1, 'Interview Test', 'DE', 'de-DE', 'active',
                'org-free-tier')`, []any{f.orgDID}},
		{`INSERT INTO vetchium.org_users (org_user_id, org_did, email_address,
            org_user_state, preferred_language)
            VALUES ($1, $2, 'owner@interview.example', 'active', 'de-DE')`,
			[]any{userID, f.orgDID}},
		{`INSERT INTO vetchium.org_domains (org_did, domain,
            verification_token, last_verified_at, last_conclusive_at,
            next_check_at)
            VALUES ($1, $2, 'abcdefghijklmnopqrstuvwxyz', now(), now(),
                now() + interval '1 day')`,
			[]any{f.orgDID, "interview-" + text[len(text)-12:] + ".example"}},
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
            VALUES ($1, $2, 1, 'Secret Panel', 'interview')`,
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

// seed inserts application number for applicant in state at the interview
// stage, with interview 1 scheduled start from now (a negative interval has
// already started), as the Org's own writes would have left it.
func (f *fixture) seed(
	t *testing.T, applicant pgtype.UUID, number int, state string,
	start string, interviewState string,
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
	if _, err := f.owner.Exec(ctx, `INSERT INTO vetchium.org_interviews (
            org_interview_id, org_application_id, interview_number,
            org_opening_stage_id, starts_at, duration_minutes, interview_mode,
            location, interview_state, ended_at)
        SELECT gen_random_uuid(), a.org_application_id, 1, $3,
            now() + $4::interval, 30, 'in_person', 'Room 4',
            $5::vetchium.org_interview_state,
            CASE WHEN $5 = 'scheduled' THEN NULL ELSE now() END
        FROM vetchium.org_applications AS a
        WHERE a.org_opening_id = $1 AND a.application_number = $2`,
		f.openingID, number, f.stageID, start, interviewState); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) accept(
	t *testing.T, commandID, applicant pgtype.UUID, number, interview int,
) commands.Response {
	t.Helper()
	body, err := json.Marshal(federationspec.HubAcceptInterviewPayload{
		OpeningNumber:     1,
		ApplicationNumber: applications.ApplicationNumber(number),
		InterviewNumber:   applications.InterviewNumber(interview),
		ApplicantDID:      hub.HubUserDID(dbvalue.FormatUUID(applicant)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return f.send(t, federationspec.HubAcceptInterviewKind, commandID, body)
}

func (f *fixture) reschedule(
	t *testing.T, commandID, applicant pgtype.UUID, number, interview int,
	note string,
) commands.Response {
	t.Helper()
	body, err := json.Marshal(federationspec.HubRescheduleInterviewPayload{
		OpeningNumber:     1,
		ApplicationNumber: applications.ApplicationNumber(number),
		InterviewNumber:   applications.InterviewNumber(interview),
		ApplicantDID:      hub.HubUserDID(dbvalue.FormatUUID(applicant)),
		Note:              applications.InterviewRescheduleNote(note),
	})
	if err != nil {
		t.Fatal(err)
	}
	return f.send(t, federationspec.HubRescheduleInterviewKind, commandID, body)
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

// state is the application's version and the interview's answer.
func (f *fixture) state(t *testing.T, number int) string {
	t.Helper()
	return f.scalar(t, `SELECT a.version::text || ':' ||
        i.applicant_response::text || ':' || COALESCE(i.reschedule_note, '')
        FROM vetchium.org_applications AS a
        JOIN vetchium.org_interviews AS i USING (org_application_id)
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

func TestHubAnswersAnUpcomingInterviewIntegration(t *testing.T) {
	f := newFixture(t)
	for index, test := range []struct {
		name     string
		send     func(applicant pgtype.UUID, number int, id pgtype.UUID) commands.Response
		state    string
		action   string
		sendNext func(applicant pgtype.UUID, number int) commands.Response
	}{
		{
			"accept", func(applicant pgtype.UUID, number int, id pgtype.UUID) commands.Response {
				return f.accept(t, id, applicant, number, 1)
			},
			"2:accepted:", "interview_accepted",
			func(applicant pgtype.UUID, number int) commands.Response {
				return f.accept(t, newDID(t), applicant, number, 1)
			},
		},
		{
			"reschedule", func(applicant pgtype.UUID, number int, id pgtype.UUID) commands.Response {
				return f.reschedule(t, id, applicant, number, 1, "Travelling")
			},
			"2:reschedule_requested:Travelling",
			"interview_reschedule_requested",
			func(applicant pgtype.UUID, number int) commands.Response {
				return f.reschedule(t, newDID(t), applicant, number, 1, "Again")
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			applicant, number := newDID(t), index+1
			f.seed(t, applicant, number, "in_pipeline", "1 day", "scheduled")
			commandID := newDID(t)
			response := test.send(applicant, number, commandID)
			var result federationspec.HubInterviewResponseResult
			if response.Status != 200 ||
				json.Unmarshal(response.Body, &result) != nil ||
				int(result.ApplicationNumber) != number ||
				result.InterviewNumber != 1 {
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
                  AND h.application_version = 2 AND h.interview_number = 1`,
				f.openingID, number, test.action); got != "1" {
				t.Fatalf("history entries = %s", got)
			}
			entity := fmt.Sprintf("%s:1:%d", dbvalue.FormatUUID(f.orgDID), number)
			if got := f.scalar(t, `SELECT payload::text
                FROM vetchium.audit_events
                WHERE action = $1 AND entity_id = $2
                  AND actor_type = 'hub_user' AND actor_id = $3`,
				"org.application."+test.action, entity,
				dbvalue.FormatUUID(applicant)); strings.Contains(got, "Travelling") ||
				!strings.Contains(got, `"interview_number": 1`) {
				t.Fatalf("audit payload = %s", got)
			}
			payload := f.scalar(t, `SELECT convert_from(payload_bytes, 'UTF8')
                FROM vetchium.federation_outbox
                WHERE aggregate_id = $1 AND aggregate_version = 2
                  AND destination_principal_did = $2`, entity, applicant)
			var projected federationspec.HubApplicationChangedPayload
			if err := json.Unmarshal([]byte(payload), &projected); err != nil ||
				string(projected.Status) != "interviewing" ||
				len(projected.PendingActions) != 0 ||
				strings.Contains(payload, "Secret Panel") ||
				strings.Contains(payload, "Travelling") {
				t.Fatalf("projection payload = %s", payload)
			}
			replayed := test.send(applicant, number, commandID)
			if replayed.Status != 200 || string(replayed.Body) != string(response.Body) {
				t.Fatalf("replay = %d %s", replayed.Status, replayed.Body)
			}
			if got := f.state(t, number); got != test.state {
				t.Fatalf("replay changed the state: %s", got)
			}
			again := test.sendNext(applicant, number)
			if again.Status != 409 ||
				problemType(t, again) != "hub-application-state-conflict" {
				t.Fatalf("second answer = %d %s", again.Status, again.Body)
			}
		})
	}
}

func TestHubInterviewAnswerRefusalsIntegration(t *testing.T) {
	f := newFixture(t)
	owner, other := newDID(t), newDID(t)
	f.seed(t, owner, 1, "in_pipeline", "1 day", "scheduled")
	f.seed(t, newDID(t), 2, "in_pipeline", "1 day", "scheduled")
	cancelled, started, completed, ended := newDID(t), newDID(t), newDID(t), newDID(t)
	f.seed(t, cancelled, 3, "in_pipeline", "1 day", "cancelled")
	f.seed(t, started, 4, "in_pipeline", "-1 hour", "scheduled")
	f.seed(t, completed, 5, "in_pipeline", "-1 hour", "completed")
	f.seed(t, ended, 6, "withdrawn", "1 day", "scheduled")
	for name, test := range map[string]struct {
		response commands.Response
		want     string
	}{
		"another interview number": {
			f.accept(t, newDID(t), owner, 1, 2), "hub-application-not-found",
		},
		"another applicant": {
			f.accept(t, newDID(t), other, 2, 1), "hub-application-not-found",
		},
		"unknown application": {
			f.accept(t, newDID(t), owner, 9, 1), "hub-application-not-found",
		},
		"cancelled": {
			f.accept(t, newDID(t), cancelled, 3, 1), "hub-application-state-conflict",
		},
		"started": {
			f.reschedule(t, newDID(t), started, 4, 1, "Later"),
			"hub-application-state-conflict",
		},
		"completed": {
			f.accept(t, newDID(t), completed, 5, 1), "hub-application-state-conflict",
		},
		"application left the pipeline": {
			f.accept(t, newDID(t), ended, 6, 1), "hub-application-state-conflict",
		},
		"homed at another tenant": {
			f.accept(t, newDID(t), f.elsewhere, 1, 1), "federation-initiator-mismatch",
		},
		"empty note": {
			f.reschedule(t, newDID(t), owner, 1, 1, "  "), "validation-failed",
		},
	} {
		if problemType(t, test.response) != test.want {
			t.Errorf("%s: response = %d %s", name, test.response.Status,
				test.response.Body)
		}
	}
	// An accept payload carries no note, and no payload an extra field.
	applicantText := dbvalue.FormatUUID(owner)
	for name, body := range map[string]string{
		"a note on accept": `{"opening_number":1,"application_number":1,` +
			`"interview_number":1,"applicant_did":"` + applicantText +
			`","note":"x"}`,
		"an unknown field": `{"opening_number":1,"application_number":1,` +
			`"interview_number":1,"applicant_did":"` + applicantText +
			`","stage":"Panel"}`,
	} {
		malformed := f.send(t, federationspec.HubAcceptInterviewKind, newDID(t),
			[]byte(body))
		if malformed.Status != 400 || problemType(t, malformed) != "validation-failed" {
			t.Errorf("%s: %d %s", name, malformed.Status, malformed.Body)
		}
	}
	if got := f.state(t, 1); got != "1:pending:" {
		t.Fatalf("refusals changed the application: %s", got)
	}
	if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE aggregate_id LIKE $1`, dbvalue.FormatUUID(f.orgDID)+"%"); got != "0" {
		t.Fatalf("refusals enqueued %s events", got)
	}
}
