package commands

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

const testKind federationspec.CommandKind = "test-rename-hub-user"

// integrationPools returns the owner pool, for fixtures and cleanup, and a
// pool acting as the application role, so the audit_required trigger
// applies to everything the code under test commits.
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

// seedHubUser creates a Hub user owned by the test and removes it, its
// operations, command results, and audit events afterwards.
func seedHubUser(t *testing.T, owner *pgxpool.Pool) Principal {
	t.Helper()
	ctx := context.Background()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	text := dbvalue.FormatUUID(did)
	raw := hex.EncodeToString(did.Bytes[10:])
	_, err = owner.Exec(ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')), 'Before',
                'test-hash', 'SG', 'hub-free-tier')`,
		did, raw[:8]+"-"+raw[:11], "commands-"+text+"@example.com")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.audit_events
            WHERE entity_id = $1 OR entity_id IN (
                SELECT operation_id::text FROM vetchium.federation_operations
                WHERE aggregate_id = $1)`, text)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_operations
            WHERE aggregate_id = $1`, text)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_command_ledger
            WHERE aggregate_id = $1`, text)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.hub_users
            WHERE hub_user_did = $1`, did)
	})
	return Principal{Type: directoryspec.PrincipalHubUser, DID: did}
}

type renamePayload struct {
	DisplayName string `json:"display_name"`
	Reject      bool   `json:"reject,omitempty"`
}

type renameResult struct {
	DisplayName string `json:"display_name"`
}

var conflictProblem = problem.Details{
	Type: "vetchium-problem-details/test-conflict", Title: "Test conflict",
	Status: 409,
}

// renameHandler is a command kind registered only in tests: it renames the
// authority Hub user and audits the change, or writes and then rejects.
func renameHandler(calls *atomic.Int32) Handler {
	return func(
		ctx context.Context, tx pgx.Tx, command Command,
	) (Result, error) {
		calls.Add(1)
		var payload renamePayload
		if err := json.Unmarshal(command.Payload, &payload); err != nil {
			return Result{}, err
		}
		_, err := tx.Exec(ctx, `INSERT INTO vetchium.audit_events (
                tenant_id, action, entity_type, entity_id, actor_type,
                actor_id, source, idempotency_key
            ) VALUES ($1, 'test.hub-user.renamed', 'hub_user', $2, 'tenant',
                $3, 'mesh-api', $4)`,
			command.TenantID, dbvalue.FormatUUID(command.Authority.DID),
			command.SourceTenantID, dbvalue.FormatUUID(command.CommandID))
		if err != nil {
			return Result{}, err
		}
		if _, err := tx.Exec(ctx, `UPDATE vetchium.hub_users
            SET display_name = $2 WHERE hub_user_did = $1`,
			command.Authority.DID, payload.DisplayName); err != nil {
			return Result{}, err
		}
		if payload.Reject {
			return Rejected(conflictProblem), nil
		}
		return Succeeded(201, renameResult{DisplayName: payload.DisplayName}), nil
	}
}

type fixedLocator bool

func (l fixedLocator) IsLocal(
	context.Context, *sqlc.Queries, Principal,
) (bool, error) {
	return bool(l), nil
}

// scriptedRelay answers with responses in order, then with fallback.
type scriptedRelay struct {
	mu        sync.Mutex
	responses []func() (Response, error)
	fallback  func() (Response, error)
	requests  []federationspec.ExecuteCommandRequest
}

func (r *scriptedRelay) Execute(
	_ context.Context, request federationspec.ExecuteCommandRequest,
) (Response, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.requests = append(r.requests, request)
	if call := len(r.requests) - 1; call < len(r.responses) {
		return r.responses[call]()
	}
	if r.fallback != nil {
		return r.fallback()
	}
	return Response{}, fmt.Errorf("%w: unscripted call", ErrOutcomeUnknown)
}

func (r *scriptedRelay) sent() []federationspec.ExecuteCommandRequest {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]federationspec.ExecuteCommandRequest(nil), r.requests...)
}

func testKey() [32]byte { return sha256.Sum256([]byte("federation-test")) }

func newTestSender(
	app *pgxpool.Pool, executor *Executor, relay Relay,
) *Sender {
	return NewSender(SenderConfig{
		Pool: app, TenantID: "sgp", Source: "hub-api",
		Executor: executor, Relay: relay,
		ResultKeys: map[OwnerType][32]byte{OwnerHubUser: testKey()},
	})
}

func renameRequest(principal Principal, name, key string) Request {
	digest := sha256.Sum256([]byte(name))
	return Request{
		Kind: testKind, Authority: principal,
		AggregateID: dbvalue.FormatUUID(principal.DID),
		Owner: Owner{
			Type: OwnerHubUser, ID: dbvalue.FormatUUID(principal.DID),
		},
		IdempotencyKey: common.IdempotencyKey(key),
		RequestDigest:  digest[:],
		Payload:        renamePayload{DisplayName: name},
	}
}

func displayName(t *testing.T, owner *pgxpool.Pool, principal Principal) string {
	t.Helper()
	var name string
	if err := owner.QueryRow(context.Background(), `SELECT display_name
        FROM vetchium.hub_users WHERE hub_user_did = $1`, principal.DID).
		Scan(&name); err != nil {
		t.Fatal(err)
	}
	return name
}

func countRows(t *testing.T, owner *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var count int
	if err := owner.QueryRow(context.Background(), sql, args...).
		Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func operationRow(
	t *testing.T, owner *pgxpool.Pool, operationID pgtype.UUID,
) sqlc.VetchiumFederationOperation {
	t.Helper()
	operation, err := sqlc.New(owner).GetFederationOperation(
		context.Background(), operationID,
	)
	if err != nil {
		t.Fatal(err)
	}
	return operation
}

func TestLocalCommandExecutesInProcessAndReplays(t *testing.T) {
	owner, app := integrationPools(t)
	principal := seedHubUser(t, owner)
	var calls atomic.Int32
	registry := NewRegistry()
	registry.Register(testKind, renameHandler(&calls))
	relay := &scriptedRelay{}
	sender := newTestSender(app, NewExecutor(ExecutorConfig{
		Pool: app, TenantID: "sgp", Registry: registry,
	}), relay)
	ctx := context.Background()
	request := renameRequest(principal, "After", "local-command-idempotency-key-1")

	outcome, err := sender.Send(ctx, request)
	if err != nil || outcome.State != StateSucceeded ||
		outcome.Response.Status != 201 ||
		string(outcome.Response.Body) != `{"display_name":"After"}` {
		t.Fatalf("outcome = %+v (%s), err = %v", outcome, outcome.Response.Body, err)
	}
	if len(relay.sent()) != 0 || calls.Load() != 1 ||
		displayName(t, owner, principal) != "After" {
		t.Fatalf("relay calls = %d, handler calls = %d", len(relay.sent()),
			calls.Load())
	}
	operation := operationRow(t, owner, outcome.OperationID)
	if operation.State != sqlc.VetchiumFederationOperationStateSucceeded ||
		len(operation.PayloadBytes) != 0 ||
		string(operation.ResponseCiphertext) == `{"display_name":"After"}` {
		t.Fatalf("operation = %+v", operation)
	}
	if count := countRows(t, owner, `SELECT count(*)
        FROM vetchium.federation_command_ledger
        WHERE command_id = $1 AND source_tenant_id = 'sgp'
          AND response_status = 201`, operation.CommandID); count != 1 {
		t.Fatalf("ledger rows = %d", count)
	}

	replayed, err := sender.Send(ctx, request)
	if err != nil || replayed.OperationID != outcome.OperationID ||
		replayed.State != StateSucceeded ||
		string(replayed.Response.Body) != string(outcome.Response.Body) ||
		calls.Load() != 1 {
		t.Fatalf("replay = %+v, err = %v, calls = %d", replayed, err, calls.Load())
	}
	if count := countRows(t, owner, `SELECT count(*) FROM vetchium.audit_events
        WHERE action = 'test.hub-user.renamed' AND entity_id = $1`,
		dbvalue.FormatUUID(principal.DID)); count != 1 {
		t.Fatalf("business audit events = %d, want 1", count)
	}

	changed := renameRequest(principal, "Other", "local-command-idempotency-key-1")
	if _, err := sender.Send(ctx, changed); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("changed request err = %v", err)
	}
	foreign := request
	foreign.Owner.ID = "someone-else"
	if _, err := sender.Send(ctx, foreign); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("foreign owner err = %v", err)
	}
}

func TestExecutorReplaysRejectsConflictsAndRollsBackRejections(t *testing.T) {
	owner, app := integrationPools(t)
	principal := seedHubUser(t, owner)
	var calls atomic.Int32
	registry := NewRegistry()
	registry.Register(testKind, renameHandler(&calls))
	executor := NewExecutor(ExecutorConfig{
		Pool: app, TenantID: "usa1", Registry: registry,
	})
	ctx := context.Background()
	commandID, _ := dbvalue.NewUUID()
	correlationID, _ := dbvalue.NewUUID()
	command := Command{
		CommandID: commandID, CorrelationID: correlationID,
		SourceTenantID: "sgp", Kind: testKind, Authority: principal,
		AggregateID: dbvalue.FormatUUID(principal.DID),
		Payload:     json.RawMessage(`{"display_name":"Rejected","reject":true}`),
	}
	first, err := executor.Execute(ctx, command)
	if err != nil || first.Status != 409 || first.succeeded() {
		t.Fatalf("rejection = %+v, err = %v", first, err)
	}
	if name := displayName(t, owner, principal); name != "Before" {
		t.Fatalf("rejected write committed: display name %q", name)
	}
	if count := countRows(t, owner, `SELECT count(*) FROM vetchium.audit_events
        WHERE action = 'test.hub-user.renamed' AND entity_id = $1`,
		dbvalue.FormatUUID(principal.DID)); count != 0 {
		t.Fatalf("rejected audit committed: %d", count)
	}
	reencoded := command
	reencoded.Payload = json.RawMessage(
		` {"reject": true, "display_name": "Rejected"}`,
	)
	again, err := executor.Execute(ctx, reencoded)
	if err != nil || again.Status != 409 || calls.Load() != 1 {
		t.Fatalf("replay = %+v, err = %v, calls = %d", again, err, calls.Load())
	}
	for name, change := range map[string]func(*Command){
		"payload": func(c *Command) {
			c.Payload = json.RawMessage(`{"display_name":"Other"}`)
		},
		"source tenant": func(c *Command) { c.SourceTenantID = "deu" },
		"kind":          func(c *Command) { c.Kind = "test-other" },
	} {
		conflicting := command
		change(&conflicting)
		if _, err := executor.Execute(ctx, conflicting); !errors.Is(
			err, ErrCommandConflict,
		) {
			t.Errorf("%s change err = %v, want conflict", name, err)
		}
	}

	unknown := command
	unknown.CommandID, _ = dbvalue.NewUUID()
	unknown.Kind = "test-unregistered"
	if _, err := executor.Execute(ctx, unknown); !errors.Is(err, ErrUnsupportedKind) {
		t.Fatalf("unknown kind err = %v", err)
	}
	elsewhere := command
	elsewhere.CommandID, _ = dbvalue.NewUUID()
	elsewhere.Authority.DID, _ = dbvalue.NewUUIDv7(time.Now())
	if _, err := executor.Execute(ctx, elsewhere); !errors.Is(err, ErrMisdirected) {
		t.Fatalf("misdirected err = %v", err)
	}
	if count := countRows(t, owner, `SELECT count(*)
        FROM vetchium.federation_command_ledger WHERE command_id = ANY($1)`,
		[]pgtype.UUID{unknown.CommandID, elsewhere.CommandID}); count != 0 {
		t.Fatalf("refused commands left %d ledger rows", count)
	}
}

// The stack's own workers may also recover these operations while the test
// runs, so assertions hold whichever driver records an attempt first.
func TestRemoteCommandOutcomesAndRecovery(t *testing.T) {
	owner, app := integrationPools(t)
	principal := seedHubUser(t, owner)
	registry := NewRegistry()
	var calls atomic.Int32
	registry.Register(testKind, renameHandler(&calls))
	executor := NewExecutor(ExecutorConfig{
		Pool: app, TenantID: "sgp", Registry: registry,
		Locator: fixedLocator(false),
	})
	ctx := context.Background()
	recoverDue := func(sender *Sender, operationID pgtype.UUID) {
		t.Helper()
		if _, err := owner.Exec(ctx, `UPDATE vetchium.federation_operations
            SET next_attempt_at = now() - interval '1 second'
            WHERE operation_id = $1`, operationID); err != nil {
			t.Fatal(err)
		}
		// Other tests' operations in the shared database may fail to
		// recover here; the assertions below check this one's state.
		if _, err := sender.Recover(ctx); err != nil {
			t.Log(err)
		}
	}

	sentCommand := func(relay *scriptedRelay, commandID pgtype.UUID) int {
		sent := 0
		for _, request := range relay.sent() {
			if request.CommandID == directoryspec.CommandID(
				dbvalue.FormatUUID(commandID)) {
				sent++
			}
		}
		return sent
	}
	operationsForKey := func(key string) int {
		return countRows(t, owner, `SELECT count(*)
            FROM vetchium.federation_operations
            WHERE kind = $1 AND aggregate_id = $2 AND idempotency_key = $3`,
			string(testKind), dbvalue.FormatUUID(principal.DID), key)
	}

	t.Run("not sent is abandoned and the same key sends afresh", func(t *testing.T) {
		relay := &scriptedRelay{
			responses: []func() (Response, error){
				func() (Response, error) {
					return Response{}, fmt.Errorf("%w: relay down", ErrNotSent)
				},
			},
			fallback: func() (Response, error) {
				return Response{
					Status: 201, Body: json.RawMessage(`{"display_name":"Later"}`),
				}, nil
			},
		}
		sender := newTestSender(app, executor, relay)
		const key = "remote-unsent-idempotency-key-1"
		request := renameRequest(principal, "Later", key)
		outcome, err := sender.Send(ctx, request)
		if err != nil || outcome.State != StateUnavailable {
			t.Fatalf("outcome = %+v, err = %v", outcome, err)
		}
		if count := operationsForKey(key); count != 0 {
			t.Fatalf("unsent command left %d operations", count)
		}
		if count := countRows(t, owner, `SELECT count(*)
            FROM vetchium.audit_events
            WHERE action = 'federation.operation.abandoned'
              AND entity_id = $1`,
			dbvalue.FormatUUID(outcome.OperationID)); count != 1 {
			t.Fatalf("abandon audit events = %d, want 1", count)
		}
		firstCommand := relay.sent()[0].CommandID
		if _, err := sender.Recover(ctx); err != nil {
			t.Log(err)
		}
		for _, sent := range relay.sent()[1:] {
			if sent.CommandID == firstCommand {
				t.Fatal("recovery sent an abandoned command")
			}
		}

		again, err := sender.Send(ctx, request)
		if err != nil || again.State != StateSucceeded ||
			again.Response.Status != 201 ||
			again.OperationID == outcome.OperationID {
			t.Fatalf("retry = %+v, err = %v", again, err)
		}
		retried := operationRow(t, owner, again.OperationID)
		if directoryspec.CommandID(dbvalue.FormatUUID(retried.CommandID)) ==
			firstCommand || sentCommand(relay, retried.CommandID) != 1 {
			t.Fatalf("retry reused the abandoned command: %+v", retried)
		}
	})

	t.Run("not sent after another recorded attempt stays pending", func(t *testing.T) {
		var operationID pgtype.UUID
		relay := &scriptedRelay{
			responses: []func() (Response, error){
				func() (Response, error) {
					// A recovery attempt recorded while the first was in
					// flight may have sent the command.
					if _, err := owner.Exec(ctx, `UPDATE vetchium.federation_operations
                        SET attempt_count = attempt_count + 1
                        WHERE kind = $1 AND idempotency_key = $2`,
						string(testKind), "remote-raced-idempotency-key-1"); err != nil {
						t.Error(err)
					}
					return Response{}, fmt.Errorf("%w: relay down", ErrNotSent)
				},
			},
		}
		sender := newTestSender(app, executor, relay)
		outcome, err := sender.Send(ctx, renameRequest(
			principal, "Raced", "remote-raced-idempotency-key-1",
		))
		if err != nil || outcome.State != StatePending {
			t.Fatalf("outcome = %+v, err = %v", outcome, err)
		}
		operationID = outcome.OperationID
		if operationRow(t, owner, operationID).State !=
			sqlc.VetchiumFederationOperationStatePending {
			t.Fatal("possibly sent operation was abandoned")
		}
	})

	t.Run("an expired operation is no longer driven and frees its key", func(t *testing.T) {
		relay := &scriptedRelay{
			responses: []func() (Response, error){
				func() (Response, error) { return Response{}, ErrOutcomeUnknown },
			},
			fallback: func() (Response, error) {
				return Response{
					Status: 201, Body: json.RawMessage(`{"display_name":"Fresh"}`),
				}, nil
			},
		}
		sender := newTestSender(app, executor, relay)
		const key = "remote-expired-idempotency-key-1"
		request := renameRequest(principal, "Fresh", key)
		outcome, err := sender.Send(ctx, request)
		if err != nil || outcome.State != StatePending {
			t.Fatalf("outcome = %+v, err = %v", outcome, err)
		}
		expired := operationRow(t, owner, outcome.OperationID)
		if _, err := owner.Exec(ctx, `UPDATE vetchium.federation_operations
            SET created_at = now() - interval '2 hours',
                updated_at = now() - interval '2 hours',
                next_attempt_at = now() - interval '1 second',
                expires_at = now() - interval '1 second'
            WHERE operation_id = $1`, outcome.OperationID); err != nil {
			t.Fatal(err)
		}
		if _, err := sender.Recover(ctx); err != nil {
			t.Log(err)
		}
		if sentCommand(relay, expired.CommandID) != 1 {
			t.Fatal("recovery drove an expired operation")
		}

		again, err := sender.Send(ctx, request)
		if err != nil || again.State != StateSucceeded ||
			again.OperationID == outcome.OperationID {
			t.Fatalf("reuse after expiry = %+v, err = %v", again, err)
		}
		if count := operationsForKey(key); count != 1 {
			t.Fatalf("operations for the key = %d, want 1", count)
		}
		if count := countRows(t, owner, `SELECT count(*)
            FROM vetchium.audit_events
            WHERE action = 'federation.operation.expired' AND entity_id = $1`,
			dbvalue.FormatUUID(outcome.OperationID)); count != 1 {
			t.Fatalf("expiry audit events = %d, want 1", count)
		}
	})

	t.Run("unknown outcome is pending until recovery resolves it", func(t *testing.T) {
		relay := &scriptedRelay{
			responses: []func() (Response, error){
				func() (Response, error) { return Response{}, ErrOutcomeUnknown },
			},
			fallback: func() (Response, error) {
				return Response{
					Status: 201, Body: json.RawMessage(`{"display_name":"Remote"}`),
				}, nil
			},
		}
		sender := newTestSender(app, executor, relay)
		request := renameRequest(
			principal, "Remote", "remote-unknown-idempotency-key-1",
		)
		outcome, err := sender.Send(ctx, request)
		if err != nil || outcome.State != StatePending {
			t.Fatalf("outcome = %+v, err = %v", outcome, err)
		}
		status, err := sqlc.New(owner).GetHubFederationOperationStatus(ctx,
			sqlc.GetHubFederationOperationStatusParams{
				OperationID:      outcome.OperationID,
				OwnerPrincipalID: dbvalue.FormatUUID(principal.DID),
			})
		if err != nil || status.State != sqlc.VetchiumFederationOperationStatePending {
			t.Fatalf("status = %+v, err = %v", status, err)
		}
		for attempt := 0; attempt < 5 &&
			operationRow(t, owner, outcome.OperationID).State ==
				sqlc.VetchiumFederationOperationStatePending; attempt++ {
			recoverDue(sender, outcome.OperationID)
		}
		replayed, err := sender.Send(ctx, request)
		if err != nil || replayed.State != StateSucceeded ||
			replayed.Response.Status != 201 ||
			string(replayed.Response.Body) != `{"display_name":"Remote"}` {
			t.Fatalf("replay = %+v, err = %v", replayed, err)
		}
		if calls.Load() != 0 {
			t.Fatal("a remote command ran locally")
		}
	})

	t.Run("deterministic rejection resolves failed", func(t *testing.T) {
		relay := &scriptedRelay{responses: []func() (Response, error){
			func() (Response, error) {
				return Response{
					Status: 404, Body: json.RawMessage(
						`{"type":"vetchium-problem-details/federation-authority-not-found","status":404}`,
					),
				}, nil
			},
		}}
		sender := newTestSender(app, executor, relay)
		outcome, err := sender.Send(ctx,
			renameRequest(principal, "Gone", "remote-rejected-idempotency-key-1"))
		if err != nil || outcome.State != StateFailed ||
			outcome.Response.Status != 404 {
			t.Fatalf("outcome = %+v, err = %v", outcome, err)
		}
		if operationRow(t, owner, outcome.OperationID).State !=
			sqlc.VetchiumFederationOperationStateFailed {
			t.Fatal("operation not failed")
		}
	})
}
