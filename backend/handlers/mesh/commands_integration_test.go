package mesh

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
	"backend/internal/federation/commands"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
)

type fixedLocator bool

func (l fixedLocator) IsLocal(
	context.Context, *sqlc.Queries, commands.Principal,
) (bool, error) {
	return bool(l), nil
}

// peerHandlerStub delivers to an authority's real peer handler as the
// calling tenant, as the mutual-TLS listener and its middleware would.
// initiatorHomedAt is the authority's directory: it homes every initiator at
// one tenant.
type initiatorHomedAt directoryspec.TenantID

func (home initiatorHomedAt) ResolvePrincipal(
	_ context.Context, request directoryspec.ResolvePrincipalRequest,
) (directoryspec.ResolvePrincipalResponse, *problem.Details, error) {
	return directoryspec.ResolvePrincipalResponse{
		PrincipalType: request.PrincipalType,
		PrincipalDID:  request.PrincipalDID,
		HomeTenantID:  directoryspec.TenantID(home), RoutingVersion: 1,
	}, nil, nil
}

type peerHandlerStub struct {
	authority *meshapi.Server
	caller    directoryspec.TenantID
}

func (p peerHandlerStub) Execute(
	ctx context.Context, _ directoryspec.TenantID,
	request federationspec.ExecuteCommandRequest,
) (commands.PeerOutcome, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return commands.PeerOutcome{}, err
	}
	httpRequest := httptest.NewRequestWithContext(
		meshidentity.WithTenant(ctx, p.caller), http.MethodPost,
		"/api/mesh/commands/execute", bytes.NewReader(body),
	)
	httpRequest.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	PeerExecuteCommand(p.authority)(recorder, httpRequest)
	if recorder.Code == http.StatusOK {
		var result federationspec.CommandResult
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			return commands.PeerOutcome{}, err
		}
		return commands.PeerOutcome{Result: &commands.Response{
			Status: int(result.Status), Body: result.Body,
		}}, nil
	}
	var details problem.Details
	if err := json.Unmarshal(recorder.Body.Bytes(), &details); err != nil {
		return commands.PeerOutcome{}, err
	}
	return commands.PeerOutcome{Problem: &details}, nil
}

func TestDurableCommandAcrossTenantsIntegration(t *testing.T) {
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

	// One database plays both tenants; the locators keep the initiator from
	// seeing the authority's Org row as its own.
	orgDID, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	text := dbvalue.FormatUUID(orgDID)
	defer func() {
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.audit_events
            WHERE entity_id = $1 OR entity_id IN (
                SELECT operation_id::text FROM vetchium.federation_operations
                WHERE aggregate_id = $1)`, text)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_operations
            WHERE aggregate_id = $1`, text)
		_, _ = owner.Exec(ctx, `DELETE FROM vetchium.federation_command_ledger
            WHERE aggregate_id = $1`, text)
	}()

	var calls atomic.Int32
	registry := commands.NewRegistry()
	registry.Register("test-record-org-note",
		func(ctx context.Context, tx pgx.Tx, command commands.Command) (
			commands.Result, error,
		) {
			calls.Add(1)
			if _, err := tx.Exec(ctx, `INSERT INTO vetchium.audit_events (
                    tenant_id, action, entity_type, entity_id, actor_type,
                    actor_id, source, payload
                ) VALUES ($1, 'test.org.noted', 'org', $2, 'tenant', $3,
                    'mesh-api', $4)`,
				command.TenantID, command.AggregateID, command.SourceTenantID,
				[]byte(command.Payload)); err != nil {
				return commands.Result{}, err
			}
			return commands.Succeeded(201, map[string]string{
				"noted_by": command.SourceTenantID,
			}), nil
		},
		// The Org notes about itself, so it is also the initiator.
		func(command commands.Command) (commands.Principal, bool) {
			return command.Authority, true
		})
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	authority := &meshapi.Server{
		Runtime: apiserver.New(app, log), TenantID: "usa1",
		Commands: commands.NewExecutor(commands.ExecutorConfig{
			Pool: app, TenantID: "usa1", Registry: registry,
			Locator: fixedLocator(true), Directory: initiatorHomedAt("sgp"),
		}),
	}
	initiatorExecutor := commands.NewExecutor(commands.ExecutorConfig{
		Pool: app, TenantID: "sgp", Registry: registry,
		Locator: fixedLocator(false),
	})
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
		Commands:     initiatorExecutor,
		CommandPeers: peerHandlerStub{authority: authority, caller: "sgp"},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /mesh/commands/execute", RelayExecuteCommand(relay))
	relayHTTP := httptest.NewServer(mux)
	defer relayHTTP.Close()

	key := sha256.Sum256([]byte("federation-mesh-test"))
	sender := commands.NewSender(commands.SenderConfig{
		Pool: app, TenantID: "sgp", Source: "orgs-api",
		Executor: initiatorExecutor,
		Relay:    commands.NewRelay(relayHTTP.URL, testCredential, time.Second),
		ResultKeys: map[commands.OwnerType][32]byte{
			commands.OwnerOrgUser: key,
		},
	})
	digest := sha256.Sum256([]byte("note"))
	request := commands.Request{
		Kind: "test-record-org-note",
		Authority: commands.Principal{
			Type: directoryspec.PrincipalOrg, DID: orgDID,
		},
		AggregateID: text,
		Owner: commands.Owner{
			Type: commands.OwnerOrgUser, ID: hex.EncodeToString(digest[:8]),
		},
		IdempotencyKey: "mesh-command-idempotency-key-1",
		RequestDigest:  digest[:],
		Payload:        map[string]string{"note": "<hello>"},
	}
	outcome, err := sender.Send(ctx, request)
	if err != nil || outcome.State != commands.StateSucceeded ||
		outcome.Response.Status != 201 ||
		string(outcome.Response.Body) != `{"noted_by":"sgp"}` {
		t.Fatalf("outcome = %+v (%s), err = %v", outcome,
			outcome.Response.Body, err)
	}
	var commandID pgtype.UUID
	var source string
	if err := owner.QueryRow(ctx, `SELECT command_id, source_tenant_id
        FROM vetchium.federation_command_ledger WHERE aggregate_id = $1`,
		text).Scan(&commandID, &source); err != nil || source != "sgp" {
		t.Fatalf("ledger = %s, %v", source, err)
	}

	// A lost response makes the initiator send the identical command again:
	// the authority replays its stored result without running it twice.
	wire := federationspec.ExecuteCommandRequest{
		CommandID:              directoryspec.CommandID(dbvalue.FormatUUID(commandID)),
		CorrelationID:          directoryspec.CommandID(dbvalue.FormatUUID(outcome.OperationID)),
		Kind:                   request.Kind,
		AuthorityPrincipalType: directoryspec.PrincipalOrg,
		AuthorityPrincipalDID:  directoryspec.PrincipalDID(text),
		AggregateID:            text,
		Payload:                json.RawMessage(`{"note":"<hello>"}`),
	}
	replayed, err := commands.NewRelay(relayHTTP.URL, testCredential, time.Second).
		Execute(ctx, wire)
	if err != nil || replayed.Status != 201 || calls.Load() != 1 {
		t.Fatalf("replay = %+v, err = %v, calls = %d", replayed, err, calls.Load())
	}
	wire.Payload = json.RawMessage(`{"note":"changed"}`)
	body, _ := json.Marshal(wire)
	recorder := relayCall(relay, string(body), testCredential)
	if recorder.Code != 409 {
		t.Fatalf("changed command = %d %s", recorder.Code, recorder.Body)
	}
	if count := func() int {
		var count int
		_ = owner.QueryRow(ctx, `SELECT count(*) FROM vetchium.audit_events
            WHERE action = 'test.org.noted' AND entity_id = $1`, text).Scan(&count)
		return count
	}(); count != 1 {
		t.Fatalf("business audit events = %d, want 1", count)
	}

	misdirected := wire
	misdirected.CommandID = "c0a3a3c4-5b6d-4e7f-8a9b-0c1d2e3f4a5b"
	authority.Commands = commands.NewExecutor(commands.ExecutorConfig{
		Pool: app, TenantID: "usa1", Registry: registry,
		Locator: fixedLocator(false), Directory: initiatorHomedAt("sgp"),
	})
	body, _ = json.Marshal(misdirected)
	if recorder := relayCall(relay, string(body), testCredential); recorder.Code != 421 {
		t.Fatalf("misdirected = %d %s", recorder.Code, recorder.Body)
	}
}
