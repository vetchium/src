package hubapply

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/openings"

	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
)

// integrationPools returns the owner pool for fixtures and cleanup, and a
// pool acting as the application role so the audit_required trigger applies
// to everything the handler commits.
func integrationPools(t *testing.T) (*pgxpool.Pool, *pgxpool.Pool) {
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
	return owner, app
}

func newDID(t *testing.T) pgtype.UUID {
	t.Helper()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return did
}

type fixture struct {
	owner    *pgxpool.Pool
	executor *commands.Executor
	orgDID   pgtype.UUID
}

// newFixture seeds an active Org with opening 1 published, and removes the
// Org, its audit events, and the command results afterwards.
func newFixture(t *testing.T) *fixture {
	t.Helper()
	owner, app := integrationPools(t)
	ctx := context.Background()
	orgDID := newDID(t)
	userID := newDID(t)
	openingID := newDID(t)
	text := dbvalue.FormatUUID(orgDID)
	statements := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO vetchium.orgs (org_did, display_name, country,
            default_language, org_state, org_plan_oid)
            VALUES ($1, 'Apply Test', 'DE', 'de-DE', 'active', 'org-free-tier')`,
			[]any{orgDID}},
		{`INSERT INTO vetchium.org_users (org_user_id, org_did, email_address,
            org_user_state, preferred_language)
            VALUES ($1, $2, 'owner@apply.example', 'active', 'de-DE')`,
			[]any{userID, orgDID}},
		// now() is the statement time, so the expiry is exactly 180 days after
		// the first publication, as the table requires.
		{`INSERT INTO vetchium.org_openings (org_opening_id, org_did,
            opening_number, opening_state, created_by, first_published_at,
            expires_at)
            VALUES ($1, $2, 1, 'published', $3, now(),
                now() + interval '180 days')`,
			[]any{openingID, orgDID, userID}},
	}
	for _, statement := range statements {
		if _, err := owner.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_command_ledger
            WHERE aggregate_id LIKE $1`, text+"%")
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.audit_events
            WHERE subject_org_did = $1 OR entity_id LIKE $2`, orgDID, text+"%")
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.orgs WHERE org_did = $1`,
			orgDID)
	})
	registry := commands.NewRegistry()
	Register(registry)
	return &fixture{
		owner: owner, orgDID: orgDID,
		executor: commands.NewExecutor(commands.ExecutorConfig{
			Pool: app, TenantID: "sgp", Registry: registry,
		}),
	}
}

func (f *fixture) scalar(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var value int
	if err := f.owner.QueryRow(context.Background(), sql, args...).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func snapshot() profile.ApplicantSnapshot {
	return profile.ApplicantSnapshot{
		DisplayName: "Ada Lovelace", Handle: "abcd1234-0123456789a",
		ResidentCountry: "GB",
	}
}

// apply sends hub-apply for applicant to opening and returns the response.
func (f *fixture) apply(
	t *testing.T, commandID pgtype.UUID, applicant pgtype.UUID, opening int32,
	mutate func(*federationspec.HubApplyPayload),
) commands.Response {
	t.Helper()
	payload := federationspec.HubApplyPayload{
		OpeningNumber: openings.OpeningNumber(opening),
		ApplicantDID:  ptrDID(applicant), Snapshot: snapshot(),
	}
	if mutate != nil {
		mutate(&payload)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return f.send(t, commandID, f.orgDID, fmt.Sprint(opening), body)
}

func (f *fixture) send(
	t *testing.T, commandID, org pgtype.UUID, aggregate string, body []byte,
) commands.Response {
	t.Helper()
	response, err := f.executor.Execute(context.Background(), commands.Command{
		CommandID: commandID, CorrelationID: commandID, SourceTenantID: "sgp",
		Kind: federationspec.HubApplyKind,
		Authority: commands.Principal{
			Type: directoryspec.PrincipalOrg, DID: org,
		},
		AggregateID: dbvalue.FormatUUID(f.orgDID) + ":" + aggregate,
		Payload:     body,
	})
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func problemType(t *testing.T, response commands.Response) string {
	t.Helper()
	var body struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(response.Body, &body); err != nil {
		t.Fatal(err)
	}
	return body.Type
}

func TestHubApplyCreatesAnApplicationIntegration(t *testing.T) {
	f := newFixture(t)
	first, second := newDID(t), newDID(t)
	note := applications.ApplicationCoverNote("I would love to join")
	response := f.apply(t, newDID(t), first, 1, func(p *federationspec.HubApplyPayload) {
		p.CoverNote = &note
	})
	var result federationspec.HubApplyResult
	if response.Status != 201 || json.Unmarshal(response.Body, &result) != nil ||
		result.ApplicationNumber != 1 || result.OpeningNumber != 1 {
		t.Fatalf("first application = %d %s", response.Status, response.Body)
	}
	response = f.apply(t, newDID(t), second, 1, nil)
	if response.Status != 201 || json.Unmarshal(response.Body, &result) != nil ||
		result.ApplicationNumber != 2 {
		t.Fatalf("second application = %d %s", response.Status, response.Body)
	}
	if got := f.scalar(t, `SELECT next_application_number
        FROM vetchium.org_openings WHERE org_did = $1`, f.orgDID); got != 3 {
		t.Fatalf("next application number = %d, want 3", got)
	}
	if got := f.scalar(t, `SELECT count(*) FROM vetchium.org_applicants
        WHERE org_did = $1 AND applicant_kind = 'hub_user'`, f.orgDID); got != 2 {
		t.Fatalf("applicants = %d, want 2", got)
	}
	var state, stored, coverNote string
	if err := f.owner.QueryRow(context.Background(), `SELECT a.application_state::text,
        a.snapshot ->> 'display_name', COALESCE(a.cover_note, '')
        FROM vetchium.org_applications AS a
        JOIN vetchium.org_openings AS o USING (org_opening_id)
        WHERE o.org_did = $1 AND a.application_number = 1`, f.orgDID).
		Scan(&state, &stored, &coverNote); err != nil {
		t.Fatal(err)
	}
	if state != "submitted" || stored != "Ada Lovelace" || coverNote != string(note) {
		t.Fatalf("stored application = %q %q %q", state, stored, coverNote)
	}
	if got := f.scalar(t, `SELECT count(*) FROM vetchium.org_application_history AS h
        JOIN vetchium.org_applications AS a USING (org_application_id)
        JOIN vetchium.org_openings AS o USING (org_opening_id)
        WHERE o.org_did = $1 AND h.action = 'applied'
          AND h.actor_kind = 'applicant'`, f.orgDID); got != 2 {
		t.Fatalf("history entries = %d, want 2", got)
	}
	// Exactly one audit event per application, carrying no profile text.
	if got := f.scalar(t, `SELECT count(*) FROM vetchium.audit_events
        WHERE subject_org_did = $1 AND action = 'org.application.applied'
          AND actor_type = 'hub_user'
          AND payload::text NOT LIKE '%Lovelace%'
          AND payload::text NOT LIKE '%love to join%'`, f.orgDID); got != 2 {
		t.Fatalf("audit events = %d, want 2", got)
	}
}

func TestHubApplyReplaysTheStoredOutcomeIntegration(t *testing.T) {
	f := newFixture(t)
	applicant, commandID := newDID(t), newDID(t)
	first := f.apply(t, commandID, applicant, 1, nil)
	replay := f.apply(t, commandID, applicant, 1, nil)
	if first.Status != 201 || replay.Status != 201 ||
		string(first.Body) != string(replay.Body) {
		t.Fatalf("replay = %d %s, first = %d %s",
			replay.Status, replay.Body, first.Status, first.Body)
	}
	if got := f.scalar(t, `SELECT count(*) FROM vetchium.audit_events
        WHERE subject_org_did = $1 AND action = 'org.application.applied'`,
		f.orgDID); got != 1 {
		t.Fatalf("audit events = %d, want 1", got)
	}
}

func TestHubApplyRefusesASecondApplicationIntegration(t *testing.T) {
	f := newFixture(t)
	applicant := newDID(t)
	if response := f.apply(t, newDID(t), applicant, 1, nil); response.Status != 201 {
		t.Fatalf("first application = %d %s", response.Status, response.Body)
	}
	response := f.apply(t, newDID(t), applicant, 1, nil)
	if response.Status != 409 ||
		problemType(t, response) != "vetchium-problem-details/hub-application-exists" {
		t.Fatalf("duplicate = %d %s", response.Status, response.Body)
	}
	// A withdrawn application still counts: one per applicant ever.
	if _, err := f.owner.Exec(context.Background(), `UPDATE vetchium.org_applications
        SET application_state = 'withdrawn' WHERE org_opening_id IN (
            SELECT org_opening_id FROM vetchium.org_openings WHERE org_did = $1)`,
		f.orgDID); err != nil {
		t.Fatal(err)
	}
	response = f.apply(t, newDID(t), applicant, 1, nil)
	if response.Status != 409 ||
		problemType(t, response) != "vetchium-problem-details/hub-application-exists" {
		t.Fatalf("after withdrawal = %d %s", response.Status, response.Body)
	}
	if got := f.scalar(t, `SELECT next_application_number
        FROM vetchium.org_openings WHERE org_did = $1`, f.orgDID); got != 2 {
		t.Fatalf("a refusal consumed a number: next = %d", got)
	}
	if got := f.scalar(t, `SELECT count(*) FROM vetchium.audit_events
        WHERE subject_org_did = $1 AND action = 'org.application.applied'`,
		f.orgDID); got != 1 {
		t.Fatalf("audit events = %d, want 1", got)
	}
}

func TestHubApplyConcurrentDuplicatesCreateOneApplicationIntegration(t *testing.T) {
	f := newFixture(t)
	applicant := newDID(t)
	const attempts = 8
	statuses := make([]int, attempts)
	var wait sync.WaitGroup
	for index := range attempts {
		wait.Add(1)
		go func() {
			defer wait.Done()
			statuses[index] = f.apply(t, newDID(t), applicant, 1, nil).Status
		}()
	}
	wait.Wait()
	created, refused := 0, 0
	for _, status := range statuses {
		switch status {
		case 201:
			created++
		case 409:
			refused++
		}
	}
	if created != 1 || refused != attempts-1 {
		t.Fatalf("statuses = %v, want one 201 and the rest 409", statuses)
	}
	if got := f.scalar(t, `SELECT count(*) FROM vetchium.org_applications AS a
        JOIN vetchium.org_openings AS o USING (org_opening_id)
        WHERE o.org_did = $1`, f.orgDID); got != 1 {
		t.Fatalf("applications = %d, want 1", got)
	}
}

func TestHubApplyConcurrentApplicantsGetDistinctNumbersIntegration(t *testing.T) {
	f := newFixture(t)
	const applicants = 8
	var wait sync.WaitGroup
	for range applicants {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if response := f.apply(t, newDID(t), newDID(t), 1, nil); response.Status != 201 {
				t.Errorf("application = %d %s", response.Status, response.Body)
			}
		}()
	}
	wait.Wait()
	if got := f.scalar(t, `SELECT count(DISTINCT a.application_number)
        FROM vetchium.org_applications AS a
        JOIN vetchium.org_openings AS o USING (org_opening_id)
        WHERE o.org_did = $1 AND a.application_number BETWEEN 1 AND $2`,
		f.orgDID, applicants); got != applicants {
		t.Fatalf("distinct numbers = %d, want %d", got, applicants)
	}
	if got := f.scalar(t, `SELECT next_application_number
        FROM vetchium.org_openings WHERE org_did = $1`, f.orgDID); got != applicants+1 {
		t.Fatalf("next application number = %d", got)
	}
}

func TestHubApplyRefusesAnOpeningThatIsNotAcceptingIntegration(t *testing.T) {
	for _, change := range []struct {
		name string
		sql  string
	}{
		{"paused", `UPDATE vetchium.org_openings SET opening_state = 'paused'
            WHERE org_did = $1`},
		{"closed", `UPDATE vetchium.org_openings SET opening_state = 'closed',
            ended_at = now() WHERE org_did = $1`},
		{"suspended Org", `UPDATE vetchium.orgs SET org_state = 'suspended',
            suspended_at = now() WHERE org_did = $1`},
	} {
		t.Run(change.name, func(t *testing.T) {
			f := newFixture(t)
			if _, err := f.owner.Exec(context.Background(), change.sql, f.orgDID); err != nil {
				t.Fatal(err)
			}
			response := f.apply(t, newDID(t), newDID(t), 1, nil)
			if response.Status != 409 || problemType(t, response) !=
				"vetchium-problem-details/hub-opening-not-accepting" {
				t.Fatalf("response = %d %s", response.Status, response.Body)
			}
			if got := f.scalar(t, `SELECT count(*) FROM vetchium.org_applicants
                WHERE org_did = $1`, f.orgDID); got != 0 {
				t.Fatalf("a refusal left %d applicants", got)
			}
		})
	}
}

func TestHubApplyRefusesAnUnknownOpeningIntegration(t *testing.T) {
	f := newFixture(t)
	response := f.apply(t, newDID(t), newDID(t), 99, nil)
	if response.Status != 404 || problemType(t, response) !=
		"vetchium-problem-details/hub-opening-not-found" {
		t.Fatalf("response = %d %s", response.Status, response.Body)
	}
}

func TestHubApplyRejectsAMalformedPayloadIntegration(t *testing.T) {
	f := newFixture(t)
	cases := map[string][]byte{
		"unknown field":    []byte(`{"opening_number":1,"surprise":true}`),
		"invalid snapshot": []byte(`{"opening_number":1,"applicant_did":"x","snapshot":{}}`),
		"not an object":    []byte(`[]`),
	}
	for name, body := range cases {
		response := f.send(t, newDID(t), f.orgDID, "1", body)
		if response.Status != 400 || problemType(t, response) !=
			"vetchium-problem-details/validation-failed" {
			t.Errorf("%s: response = %d %s", name, response.Status, response.Body)
		}
	}
	if got := f.scalar(t, `SELECT count(*) FROM vetchium.org_applicants
        WHERE org_did = $1`, f.orgDID); got != 0 {
		t.Fatalf("a rejection left %d applicants", got)
	}
}

func TestHubApplyForAnUnknownOrgIsMisdirectedIntegration(t *testing.T) {
	f := newFixture(t)
	body, err := json.Marshal(federationspec.HubApplyPayload{
		OpeningNumber: 1, ApplicantDID: ptrDID(newDID(t)), Snapshot: snapshot(),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.executor.Execute(context.Background(), commands.Command{
		CommandID: newDID(t), CorrelationID: newDID(t), SourceTenantID: "sgp",
		Kind: federationspec.HubApplyKind,
		Authority: commands.Principal{
			Type: directoryspec.PrincipalOrg, DID: newDID(t),
		},
		AggregateID: "1", Payload: body,
	})
	if err != commands.ErrMisdirected {
		t.Fatalf("err = %v, want ErrMisdirected", err)
	}
}

func ptrDID(did pgtype.UUID) hub.HubUserDID {
	return hub.HubUserDID(dbvalue.FormatUUID(did))
}
