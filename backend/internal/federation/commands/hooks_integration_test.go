package commands

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/problem"

	"backend/internal/dbvalue"
)

var hookRefusal = problem.Details{
	Type: "vetchium-problem-details/test-hook-refusal", Title: "Test refusal",
	Status: 422,
}

// hookRecorder counts Prepare and Settle calls and writes one audit event
// from each, so a test can see whether the hook's transaction committed.
type hookRecorder struct {
	owner       *pgxpool.Pool
	principal   Principal
	prepares    atomic.Int32
	mu          sync.Mutex
	settled     []State
	refuse      bool
	failSettle  bool
	prepareSeen []pgtype.UUID
}

func (h *hookRecorder) audit(
	ctx context.Context, tx pgx.Tx, action string, operationID pgtype.UUID,
) error {
	_, err := tx.Exec(ctx, `INSERT INTO vetchium.audit_events (
            tenant_id, action, entity_type, entity_id, actor_type, actor_id,
            source, idempotency_key
        ) VALUES ('sgp', $1, 'hub_user', $2, 'tenant', 'hooks', 'hub-api', $3)`,
		action, dbvalue.FormatUUID(h.principal.DID),
		dbvalue.FormatUUID(operationID))
	return err
}

func (h *hookRecorder) prepare(
	ctx context.Context, tx pgx.Tx, operationID pgtype.UUID,
) (*problem.Details, error) {
	h.prepares.Add(1)
	h.mu.Lock()
	h.prepareSeen = append(h.prepareSeen, operationID)
	h.mu.Unlock()
	if err := h.audit(ctx, tx, "test.hook.prepared", operationID); err != nil {
		return nil, err
	}
	if h.refuse {
		return &hookRefusal, nil
	}
	return nil, nil
}

func (h *hookRecorder) settle(
	ctx context.Context, tx pgx.Tx, _ Command, operationID pgtype.UUID,
	outcome Outcome,
) error {
	if err := h.audit(ctx, tx, "test.hook.settled", operationID); err != nil {
		return err
	}
	if h.failSettle {
		return errors.New("settle failed")
	}
	h.mu.Lock()
	h.settled = append(h.settled, outcome.State)
	h.mu.Unlock()
	return nil
}

func (h *hookRecorder) states() []State {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]State(nil), h.settled...)
}

func (h *hookRecorder) events(t *testing.T, action string) int {
	t.Helper()
	return countRows(t, h.owner, `SELECT count(*) FROM vetchium.audit_events
        WHERE action = $1 AND entity_id = $2`, action,
		dbvalue.FormatUUID(h.principal.DID))
}

func newHooks(t *testing.T, owner *pgxpool.Pool) *hookRecorder {
	t.Helper()
	hooks := &hookRecorder{owner: owner, principal: seedHubUser(t, owner)}
	t.Cleanup(func() {
		_, _ = owner.Exec(context.Background(),
			`DELETE FROM vetchium.audit_events
             WHERE action LIKE 'test.hook.%' AND entity_id = $1`,
			dbvalue.FormatUUID(hooks.principal.DID))
	})
	return hooks
}

func hookExecutor(
	app *pgxpool.Pool, hooks *hookRecorder, local bool,
) *Executor {
	registry := NewRegistry()
	var calls atomic.Int32
	registry.Register(testKind, renameHandler(&calls), authorityInitiator)
	registry.RegisterSettle(testKind, hooks.settle)
	return NewExecutor(ExecutorConfig{
		Pool: app, TenantID: "sgp", Registry: registry,
		Locator: fixedLocator(local),
	})
}

func hookRequest(hooks *hookRecorder, name, key string) Request {
	request := renameRequest(hooks.principal, name, key)
	request.Prepare = hooks.prepare
	return request
}

func TestPrepareRunsOnceForANewOperation(t *testing.T) {
	owner, app := integrationPools(t)
	hooks := newHooks(t, owner)
	sender := newTestSender(app, hookExecutor(app, hooks, true), &scriptedRelay{})
	ctx := context.Background()
	request := hookRequest(hooks, "Once", "hook-prepare-once-idempotency-1")

	first, err := sender.Send(ctx, request)
	if err != nil || first.State != StateSucceeded {
		t.Fatalf("outcome = %+v, err = %v", first, err)
	}
	again, err := sender.Send(ctx, request)
	if err != nil || again.State != StateSucceeded ||
		again.OperationID != first.OperationID {
		t.Fatalf("replay = %+v, err = %v", again, err)
	}
	if hooks.prepares.Load() != 1 || hooks.events(t, "test.hook.prepared") != 1 {
		t.Fatalf("prepare calls = %d, events = %d, want 1",
			hooks.prepares.Load(), hooks.events(t, "test.hook.prepared"))
	}
}

func TestPrepareProblemRefusesAndStoresNothing(t *testing.T) {
	owner, app := integrationPools(t)
	hooks := newHooks(t, owner)
	hooks.refuse = true
	sender := newTestSender(app, hookExecutor(app, hooks, true), &scriptedRelay{})
	ctx := context.Background()
	const key = "hook-prepare-refused-idempotency-1"
	request := hookRequest(hooks, "Refused", key)
	count := func() int {
		return countRows(t, owner, `SELECT count(*)
            FROM vetchium.federation_operations
            WHERE kind = $1 AND aggregate_id = $2 AND idempotency_key = $3`,
			string(testKind), dbvalue.FormatUUID(hooks.principal.DID), key)
	}

	for attempt := 1; attempt <= 2; attempt++ {
		outcome, err := sender.Send(ctx, request)
		if err != nil || outcome.State != StateFailed ||
			outcome.Response.Status != hookRefusal.Status {
			t.Fatalf("attempt %d: outcome = %+v, err = %v", attempt, outcome, err)
		}
		if count() != 0 {
			t.Fatalf("attempt %d left an operation", attempt)
		}
		if int(hooks.prepares.Load()) != attempt {
			t.Fatalf("prepare calls = %d, want %d", hooks.prepares.Load(), attempt)
		}
	}
	if hooks.events(t, "test.hook.prepared") != 0 ||
		displayName(t, owner, hooks.principal) != "Before" {
		t.Fatal("a refused request kept writes")
	}
}

func TestSettleRunsForEachDefiniteOutcome(t *testing.T) {
	owner, app := integrationPools(t)

	t.Run("local success and rejection", func(t *testing.T) {
		hooks := newHooks(t, owner)
		sender := newTestSender(app, hookExecutor(app, hooks, true), &scriptedRelay{})
		ctx := context.Background()
		succeeded, err := sender.Send(ctx,
			hookRequest(hooks, "Settled", "hook-settle-local-idempotency-1"))
		if err != nil || succeeded.State != StateSucceeded {
			t.Fatalf("outcome = %+v, err = %v", succeeded, err)
		}
		rejected := hookRequest(hooks, "Rejected", "hook-settle-local-idempotency-2")
		rejected.Payload = renamePayload{DisplayName: "Rejected", Reject: true}
		failed, err := sender.Send(ctx, rejected)
		if err != nil || failed.State != StateFailed {
			t.Fatalf("outcome = %+v, err = %v", failed, err)
		}
		states := hooks.states()
		if len(states) != 2 || states[0] != StateSucceeded ||
			states[1] != StateFailed {
			t.Fatalf("settled states = %v", states)
		}
		// The replay of a stored outcome does not settle again.
		if _, err := sender.Send(ctx, hookRequest(hooks, "Settled",
			"hook-settle-local-idempotency-1")); err != nil {
			t.Fatal(err)
		}
		if len(hooks.states()) != 2 ||
			hooks.events(t, "test.hook.settled") != 2 {
			t.Fatal("a replay settled again")
		}
	})

	t.Run("abandon", func(t *testing.T) {
		hooks := newHooks(t, owner)
		relay := &scriptedRelay{fallback: func() (Response, error) {
			return Response{}, fmt.Errorf("%w: relay down", ErrNotSent)
		}}
		sender := newTestSender(app, hookExecutor(app, hooks, false), relay)
		outcome, err := sender.Send(context.Background(),
			hookRequest(hooks, "Abandoned", "hook-settle-abandon-idempotency-1"))
		if err != nil || outcome.State != StateUnavailable {
			t.Fatalf("outcome = %+v, err = %v", outcome, err)
		}
		states := hooks.states()
		if len(states) != 1 || states[0] != StateUnavailable {
			t.Fatalf("settled states = %v", states)
		}
		// Prepare's write and Settle's write both committed in their own
		// transactions.
		if hooks.events(t, "test.hook.prepared") != 1 ||
			hooks.events(t, "test.hook.settled") != 1 {
			t.Fatal("hook writes missing after abandon")
		}
	})

	t.Run("recover settles a remote outcome", func(t *testing.T) {
		hooks := newHooks(t, owner)
		relay := &scriptedRelay{
			responses: []func() (Response, error){
				func() (Response, error) {
					return Response{}, fmt.Errorf("%w: lost", ErrOutcomeUnknown)
				},
			},
			fallback: func() (Response, error) {
				return Response{Status: 201, Body: []byte(`{"display_name":"R"}`)}, nil
			},
		}
		sender := newTestSender(app, hookExecutor(app, hooks, false), relay)
		ctx := context.Background()
		outcome, err := sender.Send(ctx,
			hookRequest(hooks, "R", "hook-settle-recover-idempotency-1"))
		if err != nil || outcome.State != StatePending {
			t.Fatalf("outcome = %+v, err = %v", outcome, err)
		}
		if len(hooks.states()) != 0 {
			t.Fatal("a pending operation settled")
		}
		if _, err := owner.Exec(ctx, `UPDATE vetchium.federation_operations
            SET next_attempt_at = now() - interval '1 second'
            WHERE operation_id = $1`, outcome.OperationID); err != nil {
			t.Fatal(err)
		}
		if _, err := sender.Recover(ctx); err != nil {
			t.Log(err)
		}
		states := hooks.states()
		if len(states) != 1 || states[0] != StateSucceeded {
			t.Fatalf("settled states = %v", states)
		}
	})
}

func TestSettleErrorRollsBackAndLeavesTheOperationPending(t *testing.T) {
	owner, app := integrationPools(t)
	hooks := newHooks(t, owner)
	hooks.failSettle = true
	relay := &scriptedRelay{
		responses: []func() (Response, error){
			func() (Response, error) {
				return Response{}, fmt.Errorf("%w: lost", ErrOutcomeUnknown)
			},
		},
		fallback: func() (Response, error) {
			return Response{Status: 201, Body: []byte(`{"display_name":"R"}`)}, nil
		},
	}
	sender := newTestSender(app, hookExecutor(app, hooks, false), relay)
	ctx := context.Background()
	pending, err := sender.Send(ctx,
		hookRequest(hooks, "R", "hook-settle-error-idempotency-1"))
	if err != nil || pending.State != StatePending {
		t.Fatalf("outcome = %+v, err = %v", pending, err)
	}
	if _, err := owner.Exec(ctx, `UPDATE vetchium.federation_operations
        SET next_attempt_at = now() - interval '1 second'
        WHERE operation_id = $1`, pending.OperationID); err != nil {
		t.Fatal(err)
	}
	if _, err := sender.Recover(ctx); err == nil {
		t.Fatal("Recover hid the settle error")
	}
	if operationRow(t, owner, pending.OperationID).State !=
		"pending" || hooks.events(t, "test.hook.settled") != 0 {
		t.Fatal("a failed settle committed")
	}

	// A local command's settle error rolls back the handler's write too.
	local := newHooks(t, owner)
	local.failSettle = true
	localSender := newTestSender(app, hookExecutor(app, local, true), &scriptedRelay{})
	if _, err := localSender.Send(ctx,
		hookRequest(local, "Never", "hook-settle-error-idempotency-2")); err == nil {
		t.Fatal("Send hid the settle error")
	}
	if displayName(t, owner, local.principal) != "Before" ||
		local.events(t, "test.hook.prepared") != 0 {
		t.Fatal("a failed local settle kept writes")
	}
}
