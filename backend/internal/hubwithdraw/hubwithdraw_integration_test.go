package hubwithdraw

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
            VALUES ($1, 'Withdraw Test', 'DE', 'de-DE', 'active',
                'org-free-tier')`, []any{f.orgDID}},
		{`INSERT INTO vetchium.org_users (org_user_id, org_did, email_address,
            org_user_state, preferred_language)
            VALUES ($1, $2, 'owner@withdraw.example', 'active', 'de-DE')`,
			[]any{userID, f.orgDID}},
		{`INSERT INTO vetchium.org_domains (org_did, domain,
            verification_token, last_verified_at, last_conclusive_at,
            next_check_at)
            VALUES ($1, $2, 'abcdefghijklmnopqrstuvwxyz', now(), now(),
                now() + interval '1 day')`,
			[]any{f.orgDID, "withdraw-" + text[len(text)-12:] + ".example"}},
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

// seed inserts application number for applicant in state, at the interview
// stage when the state is a candidacy, as the Org's own transitions would
// have left it.
func (f *fixture) seed(
	t *testing.T, applicant pgtype.UUID, number int, state string,
) {
	t.Helper()
	stage := pgtype.UUID{}
	switch state {
	case "in_pipeline", "offered", "offer_accepted":
		stage = f.stageID
	}
	if _, err := f.owner.Exec(context.Background(), `WITH applicant AS (
            INSERT INTO vetchium.org_applicants (org_applicant_id, org_did,
                applicant_kind, hub_user_did)
            VALUES (gen_random_uuid(), $1, 'hub_user', $2)
            RETURNING org_applicant_id
        )
        INSERT INTO vetchium.org_applications (org_application_id,
            org_opening_id, application_number, org_applicant_id,
            application_state, snapshot, current_stage_id)
        SELECT gen_random_uuid(), $3, $4, org_applicant_id,
            $5::vetchium.org_application_state,
            '{"display_name":"Ada Lovelace"}'::jsonb, $6
        FROM applicant`,
		f.orgDID, applicant, f.openingID, number, state, stage); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) withdraw(
	t *testing.T, commandID, applicant pgtype.UUID, number int,
) commands.Response {
	t.Helper()
	body, err := json.Marshal(federationspec.HubWithdrawPayload{
		OpeningNumber:     1,
		ApplicationNumber: applications.ApplicationNumber(number),
		ApplicantDID:      hub.HubUserDID(dbvalue.FormatUUID(applicant)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return f.send(t, commandID, body)
}

func (f *fixture) send(
	t *testing.T, commandID pgtype.UUID, body []byte,
) commands.Response {
	t.Helper()
	response, err := f.executor.Execute(context.Background(), commands.Command{
		CommandID: commandID, CorrelationID: commandID, SourceTenantID: "sgp",
		Kind: federationspec.HubWithdrawKind,
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

func TestHubWithdrawFromEveryAllowedStateIntegration(t *testing.T) {
	f := newFixture(t)
	for index, state := range []string{
		"submitted", "in_pipeline", "offered", "offer_accepted",
	} {
		t.Run(state, func(t *testing.T) {
			applicant, number := newDID(t), index+1
			f.seed(t, applicant, number, state)
			commandID := newDID(t)
			response := f.withdraw(t, commandID, applicant, number)
			var result federationspec.HubWithdrawResult
			if response.Status != 200 ||
				json.Unmarshal(response.Body, &result) != nil ||
				int(result.ApplicationNumber) != number ||
				result.OpeningNumber != 1 {
				t.Fatalf("response = %d %s", response.Status, response.Body)
			}
			if got := f.scalar(t, `SELECT application_state::text || ':' ||
                version::text FROM vetchium.org_applications
                WHERE org_opening_id = $1 AND application_number = $2`,
				f.openingID, number); got != "withdrawn:2" {
				t.Fatalf("application = %s", got)
			}
			if got := f.scalar(t, `SELECT count(*)::text
                FROM vetchium.org_application_history AS h
                JOIN vetchium.org_applications AS a USING (org_application_id)
                WHERE a.org_opening_id = $1 AND a.application_number = $2
                  AND h.action = 'withdrawn' AND h.actor_kind = 'applicant'
                  AND h.application_version = 2`,
				f.openingID, number); got != "1" {
				t.Fatalf("history entries = %s", got)
			}
			entity := fmt.Sprintf("%s:1:%d", dbvalue.FormatUUID(f.orgDID), number)
			if got := f.scalar(t, `SELECT payload ->> 'previous_state'
                FROM vetchium.audit_events
                WHERE action = 'org.application.withdrawn'
                  AND entity_id = $1 AND actor_type = 'hub_user'
                  AND actor_id = $2`,
				entity, dbvalue.FormatUUID(applicant)); got != state {
				t.Fatalf("audit previous state = %s", got)
			}
			payload := f.scalar(t, `SELECT convert_from(payload_bytes, 'UTF8')
                FROM vetchium.federation_outbox
                WHERE aggregate_id = $1 AND aggregate_version = 2
                  AND destination_principal_did = $2`, entity, applicant)
			var projected federationspec.HubApplicationChangedPayload
			if err := json.Unmarshal([]byte(payload), &projected); err != nil ||
				projected.Status != "withdrawn" ||
				strings.Contains(payload, "Secret Panel") {
				t.Fatalf("projection payload = %s", payload)
			}
			replayed := f.withdraw(t, commandID, applicant, number)
			if replayed.Status != 200 || string(replayed.Body) != string(response.Body) {
				t.Fatalf("replay = %d %s", replayed.Status, replayed.Body)
			}
			if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.audit_events
                WHERE action = 'org.application.withdrawn' AND entity_id = $1`,
				entity); got != "1" {
				t.Fatalf("audit events after replay = %s", got)
			}
		})
	}
}

func TestHubWithdrawRefusesTerminalStatesIntegration(t *testing.T) {
	f := newFixture(t)
	for index, state := range []string{
		"withdrawn", "not_progressing", "offer_declined", "joined",
		"did_not_join",
	} {
		t.Run(state, func(t *testing.T) {
			applicant, number := newDID(t), index+1
			f.seed(t, applicant, number, state)
			response := f.withdraw(t, newDID(t), applicant, number)
			if response.Status != 409 ||
				problemType(t, response) != "hub-application-state-conflict" {
				t.Fatalf("response = %d %s", response.Status, response.Body)
			}
			if got := f.scalar(t, `SELECT application_state::text || ':' ||
                version::text FROM vetchium.org_applications
                WHERE org_opening_id = $1 AND application_number = $2`,
				f.openingID, number); got != state+":1" {
				t.Fatalf("application = %s", got)
			}
		})
	}
	if got := f.scalar(t, `SELECT count(*)::text FROM vetchium.federation_outbox
        WHERE aggregate_id LIKE $1`, dbvalue.FormatUUID(f.orgDID)+"%"); got != "0" {
		t.Fatalf("refusals enqueued %s events", got)
	}
}

func TestHubWithdrawFindsOnlyTheApplicantsOwnApplicationIntegration(t *testing.T) {
	f := newFixture(t)
	owner, other := newDID(t), newDID(t)
	f.seed(t, owner, 1, "submitted")
	for name, response := range map[string]commands.Response{
		"another applicant":       f.withdraw(t, newDID(t), other, 1),
		"unknown application":     f.withdraw(t, newDID(t), owner, 2),
		"homed at another tenant": f.withdraw(t, newDID(t), f.elsewhere, 1),
	} {
		want := "hub-application-not-found"
		if name == "homed at another tenant" {
			want = "federation-initiator-mismatch"
		}
		if problemType(t, response) != want {
			t.Errorf("%s: response = %d %s", name, response.Status, response.Body)
		}
	}
	malformed := f.send(t, newDID(t), []byte(
		`{"opening_number":1,"application_number":1,"applicant_did":"`+
			dbvalue.FormatUUID(owner)+`","extra":true}`))
	if malformed.Status != 400 || problemType(t, malformed) != "validation-failed" {
		t.Fatalf("malformed = %d %s", malformed.Status, malformed.Body)
	}
	if got := f.scalar(t, `SELECT application_state::text
        FROM vetchium.org_applications WHERE org_opening_id = $1`,
		f.openingID); got != "submitted" {
		t.Fatalf("state = %s", got)
	}
}
