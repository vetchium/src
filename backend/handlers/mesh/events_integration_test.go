package mesh

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
	"backend/internal/federation/events"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
)

type eventLocator bool

func (l eventLocator) IsLocal(
	context.Context, *sqlc.Queries, events.Principal,
) (bool, error) {
	return bool(l), nil
}

// eventPeerHandlerStub delivers to a destination's real peer handler as the
// calling tenant, as the mutual-TLS listener and its middleware would.
type eventPeerHandlerStub struct {
	destination *meshapi.Server
	caller      directoryspec.TenantID
}

func (p eventPeerHandlerStub) Deliver(
	ctx context.Context, _ directoryspec.TenantID,
	request federationspec.DeliverEventRequest,
) (events.Delivery, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return events.Delivery{}, err
	}
	httpRequest := httptest.NewRequestWithContext(
		meshidentity.WithTenant(ctx, p.caller), http.MethodPost,
		"/api/mesh/events/deliver", bytes.NewReader(body),
	)
	httpRequest.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	PeerDeliverEvent(p.destination)(recorder, httpRequest)
	if recorder.Code == http.StatusOK {
		var receipt federationspec.EventReceipt
		if err := json.Unmarshal(recorder.Body.Bytes(), &receipt); err != nil {
			return events.Delivery{}, err
		}
		return events.Delivery{Receipt: &receipt}, nil
	}
	var details problem.Details
	if err := json.Unmarshal(recorder.Body.Bytes(), &details); err != nil {
		return events.Delivery{}, err
	}
	if recorder.Code >= http.StatusInternalServerError {
		return events.Delivery{}, errors.New(details.Type)
	}
	return events.Delivery{Problem: &details}, nil
}

func TestOutboxEventAcrossTenantsIntegration(t *testing.T) {
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

	orgDID, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	eventID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	text := dbvalue.FormatUUID(orgDID)
	defer func() {
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.audit_events
            WHERE entity_id = $1`, dbvalue.FormatUUID(eventID))
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_inbox
            WHERE aggregate_id = $1`, text)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_event_watermarks
            WHERE destination_principal_did = $1`, orgDID)
	}()

	var calls atomic.Int32
	registry := events.NewRegistry()
	registry.Register("test-org-projected",
		func(context.Context, pgx.Tx, events.Event) error {
			calls.Add(1)
			return nil
		})
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	destination := &meshapi.Server{
		Runtime: apiserver.New(app, log), TenantID: "usa1",
		Events: events.NewReceiver(events.ReceiverConfig{
			Pool: app, TenantID: "usa1", Source: "mesh-api",
			Registry: registry, Locator: eventLocator(true),
		}),
	}
	coordinator := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			var request directoryspec.ResolvePrincipalRequest
			_ = json.NewDecoder(r.Body).Decode(&request)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(directoryspec.ResolvePrincipalResponse{
				PrincipalType: request.PrincipalType,
				PrincipalDID:  request.PrincipalDID,
				HomeTenantID:  "usa1", RoutingVersion: 1,
			})
		},
	))
	defer coordinator.Close()
	relay := &meshapi.Server{
		Runtime: apiserver.New(app, log), TenantID: "sgp",
		Credential: testCredential,
		Directory: directoryclient.New(
			coordinator.URL, "/directory", "", time.Second,
		),
		EventPeers: eventPeerHandlerStub{destination: destination, caller: "sgp"},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /mesh/events/deliver", RelayDeliverEvent(relay))
	relayHTTP := httptest.NewServer(mux)
	defer relayHTTP.Close()
	client := events.NewRelay(relayHTTP.URL, testCredential, time.Second)

	wire := federationspec.DeliverEventRequest{
		EventID:                  federationspec.EventID(dbvalue.FormatUUID(eventID)),
		Kind:                     "test-org-projected",
		DestinationPrincipalType: directoryspec.PrincipalOrg,
		DestinationPrincipalDID:  directoryspec.PrincipalDID(text),
		AggregateType:            "test_aggregate", AggregateID: text,
		AggregateVersion: 1, Payload: json.RawMessage(`{"note":"<hello>"}`),
	}
	for _, want := range []federationspec.EventDeliveryOutcome{
		federationspec.EventApplied, federationspec.EventDuplicate,
	} {
		delivery, err := client.Deliver(ctx, wire)
		if err != nil || delivery.Receipt == nil ||
			delivery.Receipt.Outcome != want || calls.Load() != 1 {
			t.Fatalf("delivery = %+v, err = %v, calls = %d", delivery, err,
				calls.Load())
		}
	}
	var source string
	if err := owner.QueryRow(ctx, `SELECT source_tenant_id
        FROM vetchium.federation_inbox WHERE event_id = $1`, eventID).
		Scan(&source); err != nil || source != "sgp" {
		t.Fatalf("receipt source = %q, %v", source, err)
	}

	changed := wire
	changed.Payload = json.RawMessage(`{"note":"changed"}`)
	body, _ := json.Marshal(changed)
	if recorder := eventRelayCall(relay, string(body), testCredential); recorder.Code != 409 {
		t.Fatalf("changed event = %d %s", recorder.Code, recorder.Body)
	}

	unknown := wire
	unknown.EventID = "c0a3a3c4-5b6d-4e7f-8a9b-0c1d2e3f4a5b"
	unknown.Kind = "test-unregistered"
	body, _ = json.Marshal(unknown)
	if recorder := eventRelayCall(relay, string(body), testCredential); recorder.Code != 400 {
		t.Fatalf("unknown kind = %d %s", recorder.Code, recorder.Body)
	}

	misdirected := wire
	misdirected.EventID = "c0a3a3c4-5b6d-4e7f-8a9b-0c1d2e3f4a5c"
	destination.Events = events.NewReceiver(events.ReceiverConfig{
		Pool: app, TenantID: "usa1", Source: "mesh-api",
		Registry: registry, Locator: eventLocator(false),
	})
	body, _ = json.Marshal(misdirected)
	if recorder := eventRelayCall(relay, string(body), testCredential); recorder.Code != 421 {
		t.Fatalf("misdirected = %d %s", recorder.Code, recorder.Body)
	}
	if count := func() int {
		var count int
		_ = owner.QueryRow(ctx, `SELECT count(*) FROM vetchium.federation_inbox
            WHERE aggregate_id = $1`, text).Scan(&count)
		return count
	}(); count != 1 {
		t.Fatalf("inbox receipts = %d, want 1", count)
	}
}
