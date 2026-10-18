package events

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

const testKind federationspec.EventKind = "test-display-name-projected"

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

// seedHubUser creates the destination Hub user and removes it with every
// outbox, inbox, watermark, and audit row naming it afterwards.
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
		did, raw[:8]+"-"+raw[:11], "events-"+text+"@example.com")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.audit_events
            WHERE entity_id = $1 OR entity_id IN (
                SELECT event_id::text FROM vetchium.federation_outbox
                WHERE destination_principal_did = $2
                UNION
                SELECT event_id::text FROM vetchium.federation_inbox
                WHERE aggregate_id = $1)`, text, did)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_outbox
            WHERE destination_principal_did = $1`, did)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_inbox
            WHERE aggregate_id = $1`, text)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_event_watermarks
            WHERE destination_principal_did = $1`, did)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.hub_users
            WHERE hub_user_did = $1`, did)
	})
	return Principal{Type: directoryspec.PrincipalHubUser, DID: did}
}

type namePayload struct {
	DisplayName string `json:"display_name"`
	Fail        bool   `json:"fail,omitempty"`
}

// projectName is an event kind registered only in tests: it projects a
// display name onto the destination Hub user, or fails once on request.
func projectName(calls *atomic.Int32, failures *atomic.Int32) Handler {
	return func(ctx context.Context, tx pgx.Tx, event Event) error {
		calls.Add(1)
		var payload namePayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE vetchium.hub_users
            SET display_name = $2 WHERE hub_user_did = $1`,
			event.Destination.DID, payload.DisplayName); err != nil {
			return err
		}
		if payload.Fail && failures.Add(-1) >= 0 {
			return errors.New("projection store unavailable")
		}
		return nil
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
	responses []func(federationspec.DeliverEventRequest) (Delivery, error)
	fallback  func(federationspec.DeliverEventRequest) (Delivery, error)
	requests  []federationspec.DeliverEventRequest
}

func (r *scriptedRelay) Deliver(
	_ context.Context, request federationspec.DeliverEventRequest,
) (Delivery, error) {
	r.mu.Lock()
	call := len(r.requests)
	r.requests = append(r.requests, request)
	r.mu.Unlock()
	if call < len(r.responses) {
		return r.responses[call](request)
	}
	if r.fallback != nil {
		return r.fallback(request)
	}
	return Delivery{}, errors.New("unscripted relay call")
}

func (r *scriptedRelay) sent(eventID pgtype.UUID) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, request := range r.requests {
		if request.EventID == federationspec.EventID(dbvalue.FormatUUID(eventID)) {
			count++
		}
	}
	return count
}

// peerRelay delivers through the wire representation to a receiver that
// stands for the destination tenant, as mesh-api and the peer would.
func peerRelay(t *testing.T, receiver *Receiver, source string) func(
	federationspec.DeliverEventRequest,
) (Delivery, error) {
	return func(request federationspec.DeliverEventRequest) (Delivery, error) {
		if fields := request.Validate(); len(fields) != 0 {
			t.Errorf("relayed an invalid event: %v", fields)
		}
		event, err := FromWire(request, source)
		if err != nil {
			return Delivery{}, err
		}
		outcome, err := receiver.Receive(context.Background(), event)
		if errors.Is(err, ErrEventConflict) {
			details := federationproblem.EventConflictError
			return Delivery{Problem: &details}, nil
		}
		if err != nil {
			return Delivery{}, err
		}
		return Delivery{Receipt: &federationspec.EventReceipt{Outcome: outcome}}, nil
	}
}

type harness struct {
	t        *testing.T
	owner    *pgxpool.Pool
	app      *pgxpool.Pool
	user     Principal
	calls    atomic.Int32
	failures atomic.Int32
	registry *Registry
}

func newHarness(t *testing.T) *harness {
	owner, app := integrationPools(t)
	h := &harness{t: t, owner: owner, app: app, user: seedHubUser(t, owner)}
	h.registry = NewRegistry()
	h.registry.Register(testKind, projectName(&h.calls, &h.failures))
	return h
}

func (h *harness) receiver(tenant string, locator Locator) *Receiver {
	return NewReceiver(ReceiverConfig{
		Pool: h.app, TenantID: tenant, Source: "workers",
		Registry: h.registry, Locator: locator,
	})
}

func (h *harness) deliverer(receiver *Receiver, relay Relay, log *slog.Logger) *Deliverer {
	return NewDeliverer(DelivererConfig{
		Pool: h.app, TenantID: "sgp", Receiver: receiver, Relay: relay,
		Log: log,
	})
}

// enqueue commits an event beside an audited change, as a write
// transaction would.
func (h *harness) enqueue(version int64, payload namePayload) pgtype.UUID {
	h.t.Helper()
	ctx := context.Background()
	tx, err := h.app.Begin(ctx)
	if err != nil {
		h.t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `INSERT INTO vetchium.audit_events (
            tenant_id, action, entity_type, entity_id, actor_type, source
        ) VALUES ('sgp', 'test.aggregate.changed', 'hub_user', $1, 'worker',
            'workers')`, h.aggregateID()); err != nil {
		h.t.Fatal(err)
	}
	eventID, err := Enqueue(ctx, tx, Outgoing{
		Kind: testKind, Destination: h.user, AggregateType: "test_aggregate",
		AggregateID: h.aggregateID(), AggregateVersion: version,
		Payload: payload,
	})
	if err != nil {
		h.t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		h.t.Fatal(err)
	}
	return eventID
}

func (h *harness) aggregateID() string { return dbvalue.FormatUUID(h.user.DID) }

type outboxState struct {
	delivered bool
	failed    bool
	attempts  int
	lastError string
	due       bool
}

func (h *harness) outbox(eventID pgtype.UUID) outboxState {
	h.t.Helper()
	var state outboxState
	var lastError pgtype.Text
	if err := h.owner.QueryRow(context.Background(), `SELECT
            delivered_at IS NOT NULL, failed_at IS NOT NULL, attempt_count,
            last_error, next_attempt_at <= now()
        FROM vetchium.federation_outbox WHERE event_id = $1`, eventID).Scan(
		&state.delivered, &state.failed, &state.attempts, &lastError,
		&state.due,
	); err != nil {
		h.t.Fatal(err)
	}
	state.lastError = lastError.String
	return state
}

// deliver makes eventID due and runs d until it is no longer pending. The
// stack's own workers share the database and may claim it first; without
// a handler for the test kind they only reschedule it.
func (h *harness) deliver(d *Deliverer, eventID pgtype.UUID) outboxState {
	h.t.Helper()
	for range 20 {
		h.makeDue(eventID)
		if _, err := d.Deliver(context.Background()); err != nil {
			h.t.Log(err)
		}
		state := h.outbox(eventID)
		if state.delivered || state.failed {
			return state
		}
	}
	return h.outbox(eventID)
}

func (h *harness) makeDue(eventID pgtype.UUID) {
	h.t.Helper()
	if _, err := h.owner.Exec(context.Background(), `UPDATE vetchium.federation_outbox
        SET next_attempt_at = now() - interval '1 second',
            lease_token = NULL, leased_until = NULL
        WHERE event_id = $1 AND delivered_at IS NULL AND failed_at IS NULL`,
		eventID); err != nil {
		h.t.Fatal(err)
	}
}

func (h *harness) displayName() string {
	h.t.Helper()
	var name string
	if err := h.owner.QueryRow(context.Background(), `SELECT display_name
        FROM vetchium.hub_users WHERE hub_user_did = $1`, h.user.DID).
		Scan(&name); err != nil {
		h.t.Fatal(err)
	}
	return name
}

func (h *harness) count(sql string, args ...any) int {
	h.t.Helper()
	var count int
	if err := h.owner.QueryRow(context.Background(), sql, args...).
		Scan(&count); err != nil {
		h.t.Fatal(err)
	}
	return count
}

func (h *harness) auditCount(action string, eventID pgtype.UUID) int {
	return h.count(`SELECT count(*) FROM vetchium.audit_events
        WHERE action = $1 AND entity_id = $2`, action,
		dbvalue.FormatUUID(eventID))
}

func failingRelay(t *testing.T) *scriptedRelay {
	return &scriptedRelay{fallback: func(
		request federationspec.DeliverEventRequest,
	) (Delivery, error) {
		t.Errorf("a local event went to the relay: %+v", request)
		return Delivery{}, errors.New("unexpected relay call")
	}}
}

func TestLocalEventAppliesInProcess(t *testing.T) {
	h := newHarness(t)
	relay := failingRelay(t)
	d := h.deliverer(h.receiver("sgp", nil), relay, nil)
	eventID := h.enqueue(1, namePayload{DisplayName: "Local"})

	state := h.deliver(d, eventID)
	if !state.delivered || h.displayName() != "Local" || h.calls.Load() != 1 {
		t.Fatalf("state = %+v, name = %q, calls = %d", state, h.displayName(),
			h.calls.Load())
	}
	if count := h.count(`SELECT count(*) FROM vetchium.federation_inbox
        WHERE event_id = $1 AND source_tenant_id = 'sgp' AND applied
          AND aggregate_version = 1`, eventID); count != 1 {
		t.Fatalf("inbox receipts = %d", count)
	}
	if h.auditCount("federation.event.received", eventID) != 1 ||
		h.auditCount("federation.event.delivered", eventID) != 1 {
		t.Fatal("delivery is missing its audit events")
	}
}

func TestRemoteEventDeliversThroughTheRelay(t *testing.T) {
	h := newHarness(t)
	remote := h.receiver("usa1", fixedLocator(true))
	relay := &scriptedRelay{fallback: peerRelay(t, remote, "sgp")}
	d := h.deliverer(h.receiver("sgp", fixedLocator(false)), relay, nil)
	eventID := h.enqueue(1, namePayload{DisplayName: "Remote"})

	state := h.deliver(d, eventID)
	if !state.delivered || relay.sent(eventID) < 1 ||
		h.displayName() != "Remote" || h.calls.Load() != 1 {
		t.Fatalf("state = %+v, sent = %d, name = %q", state,
			relay.sent(eventID), h.displayName())
	}
	if count := h.count(`SELECT count(*) FROM vetchium.audit_events
        WHERE action = 'federation.event.received' AND entity_id = $1
          AND tenant_id = 'usa1' AND actor_type = 'tenant'
          AND actor_id = 'sgp'`, dbvalue.FormatUUID(eventID)); count != 1 {
		t.Fatalf("receipt audit events = %d", count)
	}
}

func TestDuplicateAndConflictingEventIDs(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	receiver := h.receiver("usa1", fixedLocator(true))
	eventID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	event := Event{
		EventID: eventID, SourceTenantID: "sgp", Kind: testKind,
		Destination: h.user, AggregateType: "test_aggregate",
		AggregateID: h.aggregateID(), AggregateVersion: 1,
		Payload: json.RawMessage(`{"display_name":"First"}`),
	}
	first, err := receiver.Receive(ctx, event)
	if err != nil || first != federationspec.EventApplied {
		t.Fatalf("first = %q, %v", first, err)
	}
	reencoded := event
	reencoded.Payload = json.RawMessage(` { "display_name" : "First" }`)
	again, err := receiver.Receive(ctx, reencoded)
	if err != nil || again != federationspec.EventDuplicate || h.calls.Load() != 1 {
		t.Fatalf("duplicate = %q, %v, calls = %d", again, err, h.calls.Load())
	}
	if h.auditCount("federation.event.received", eventID) != 1 {
		t.Fatal("a duplicate added an audit event")
	}
	for name, change := range map[string]func(*Event){
		"payload": func(e *Event) {
			e.Payload = json.RawMessage(`{"display_name":"Other"}`)
		},
		"source tenant": func(e *Event) { e.SourceTenantID = "deu" },
		"version":       func(e *Event) { e.AggregateVersion = 2 },
		"kind":          func(e *Event) { e.Kind = "test-other-projection" },
	} {
		changed := event
		change(&changed)
		if _, err := receiver.Receive(ctx, changed); !errors.Is(
			err, ErrEventConflict,
		) {
			t.Errorf("%s change err = %v, want conflict", name, err)
		}
	}
	if h.displayName() != "First" {
		t.Fatalf("a conflicting event applied: %q", h.displayName())
	}

	var logs bytes.Buffer
	relay := &scriptedRelay{fallback: func(
		federationspec.DeliverEventRequest,
	) (Delivery, error) {
		details := federationproblem.EventConflictError
		return Delivery{Problem: &details}, nil
	}}
	d := h.deliverer(h.receiver("sgp", fixedLocator(false)), relay,
		slog.New(slog.NewTextHandler(&logs, nil)))
	conflicted := h.enqueue(2, namePayload{DisplayName: "Conflicted"})
	state := h.deliver(d, conflicted)
	if !state.failed || state.lastError != "event id conflict at destination" ||
		h.auditCount("federation.event.delivery-failed", conflicted) != 1 ||
		!bytes.Contains(logs.Bytes(), []byte("federation_event_delivery_failed")) {
		t.Fatalf("conflict state = %+v, logs = %s", state, logs.String())
	}
}

func TestOlderVersionsNeverOverwriteNewerState(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	receiver := h.receiver("usa1", fixedLocator(true))
	receive := func(version int64, name string) federationspec.EventDeliveryOutcome {
		t.Helper()
		eventID, err := dbvalue.NewUUID()
		if err != nil {
			t.Fatal(err)
		}
		outcome, err := receiver.Receive(ctx, Event{
			EventID: eventID, SourceTenantID: "sgp", Kind: testKind,
			Destination: h.user, AggregateType: "test_aggregate",
			AggregateID: h.aggregateID(), AggregateVersion: version,
			Payload: json.RawMessage(fmt.Sprintf(`{"display_name":%q}`, name)),
		})
		if err != nil {
			t.Fatal(err)
		}
		return outcome
	}
	if outcome := receive(3, "Third"); outcome != federationspec.EventApplied {
		t.Fatalf("v3 = %q", outcome)
	}
	if outcome := receive(2, "Second"); outcome != federationspec.EventSuperseded {
		t.Fatalf("late v2 = %q", outcome)
	}
	if outcome := receive(3, "Third again"); outcome != federationspec.EventSuperseded {
		t.Fatalf("another v3 = %q", outcome)
	}
	if h.displayName() != "Third" || h.calls.Load() != 1 {
		t.Fatalf("name = %q, calls = %d", h.displayName(), h.calls.Load())
	}
	if outcome := receive(4, "Fourth"); outcome != federationspec.EventApplied ||
		h.displayName() != "Fourth" {
		t.Fatalf("v4 = %q, name = %q", outcome, h.displayName())
	}
	if count := h.count(`SELECT count(*) FROM vetchium.federation_inbox
        WHERE aggregate_id = $1 AND NOT applied`, h.aggregateID()); count != 2 {
		t.Fatalf("superseded receipts = %d, want 2", count)
	}
}

func TestDeliveryRetriesAfterTheDestinationFails(t *testing.T) {
	h := newHarness(t)
	remote := h.receiver("usa1", fixedLocator(true))
	relay := &scriptedRelay{
		responses: []func(federationspec.DeliverEventRequest) (Delivery, error){
			func(federationspec.DeliverEventRequest) (Delivery, error) {
				return Delivery{}, errors.New("federation event relay " +
					federationproblem.EventUndeliveredError.Type)
			},
		},
		fallback: peerRelay(t, remote, "sgp"),
	}
	d := h.deliverer(h.receiver("sgp", fixedLocator(false)), relay, nil)
	eventID := h.enqueue(1, namePayload{DisplayName: "Eventually"})
	h.makeDue(eventID)
	if _, err := d.Deliver(context.Background()); err != nil {
		t.Log(err)
	}
	state := h.outbox(eventID)
	if relay.sent(eventID) == 1 && (state.delivered || state.due ||
		state.attempts < 1 || state.lastError == "" ||
		h.auditCount("federation.event.retry-scheduled", eventID) < 1) {
		t.Fatalf("after failed attempt = %+v", state)
	}
	state = h.deliver(d, eventID)
	if !state.delivered || h.displayName() != "Eventually" {
		t.Fatalf("after retry = %+v, name = %q", state, h.displayName())
	}

	// A failing local handler rolls back its receipt and watermark too.
	h.failures.Store(1)
	local := h.deliverer(h.receiver("sgp", nil), failingRelay(t), nil)
	failing := h.enqueue(2, namePayload{DisplayName: "Recovered", Fail: true})
	h.makeDue(failing)
	if _, err := local.Deliver(context.Background()); err != nil {
		t.Log(err)
	}
	if h.failures.Load() == 0 {
		if state := h.outbox(failing); state.delivered ||
			h.displayName() != "Eventually" ||
			h.count(`SELECT count(*) FROM vetchium.federation_inbox
                WHERE event_id = $1`, failing) != 0 {
			t.Fatalf("failed handler committed: %+v", state)
		}
	}
	if state := h.deliver(local, failing); !state.delivered ||
		h.displayName() != "Recovered" {
		t.Fatalf("after handler recovery = %+v, name = %q", state,
			h.displayName())
	}
}

func TestExpiredLeaseIsClaimedAgain(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	d := h.deliverer(h.receiver("sgp", nil), failingRelay(t), nil)
	eventID := h.enqueue(1, namePayload{DisplayName: "Leased"})
	staleLease, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	// A worker that claimed the event and stopped before finishing.
	if _, err := h.owner.Exec(ctx, `UPDATE vetchium.federation_outbox
        SET lease_token = $2, leased_until = now() + interval '1 hour',
            next_attempt_at = now() - interval '1 second',
            attempt_count = attempt_count + 1
        WHERE event_id = $1`, eventID, staleLease); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Deliver(ctx); err != nil {
		t.Log(err)
	}
	if state := h.outbox(eventID); state.delivered {
		t.Fatal("a leased event was delivered")
	}
	if _, err := h.owner.Exec(ctx, `UPDATE vetchium.federation_outbox
        SET leased_until = now() - interval '1 second'
        WHERE event_id = $1`, eventID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Deliver(ctx); err != nil {
		t.Log(err)
	}
	state := h.outbox(eventID)
	if !state.delivered {
		state = h.deliver(d, eventID)
	}
	if !state.delivered || h.displayName() != "Leased" {
		t.Fatalf("after lease expiry = %+v", state)
	}
	rows, err := sqlc.New(h.app).CompleteFederationOutboxEvent(ctx,
		sqlc.CompleteFederationOutboxEventParams{
			EventID: eventID, LeaseToken: staleLease, TenantID: "sgp",
			Outcome: "applied",
		})
	if err != nil || rows != 0 {
		t.Fatalf("stale lease completion = %d, %v", rows, err)
	}
}

func TestUnknownDestinationFailsTheEvent(t *testing.T) {
	h := newHarness(t)
	relay := &scriptedRelay{fallback: func(
		federationspec.DeliverEventRequest,
	) (Delivery, error) {
		details := federationproblem.DestinationNotFoundError
		return Delivery{Problem: &details}, nil
	}}
	d := h.deliverer(h.receiver("sgp", fixedLocator(false)), relay,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	eventID := h.enqueue(1, namePayload{DisplayName: "Nobody"})
	state := h.deliver(d, eventID)
	if !state.failed || state.lastError != "destination principal not found" ||
		h.displayName() != "Before" {
		t.Fatalf("state = %+v", state)
	}
}
