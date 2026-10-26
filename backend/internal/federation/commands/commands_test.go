package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"

	"backend/internal/dbvalue"
)

func testPrincipal(t *testing.T) Principal {
	t.Helper()
	did, err := dbvalue.ParseUUID("018f7e32-7b5a-7d31-8fd0-f7e2a852f144")
	if err != nil {
		t.Fatal(err)
	}
	return Principal{Type: directoryspec.PrincipalOrg, DID: did}
}

func TestDigestIgnoresEncodingButNotContent(t *testing.T) {
	t.Parallel()
	principal := testPrincipal(t)
	base := Command{Authority: principal, Payload: json.RawMessage(
		`{"b":"<x>","a":12345678901234567890}`,
	)}
	reencoded := Command{Authority: principal, Payload: json.RawMessage(
		` { "a" : 12345678901234567890, "b" : "<x>" } `,
	)}
	changed := Command{Authority: principal, Payload: json.RawMessage(
		`{"a":12345678901234567891,"b":"<x>"}`,
	)}
	otherAuthority := base
	otherAuthority.Authority.Type = directoryspec.PrincipalHubUser
	first, err := digest(base)
	if err != nil {
		t.Fatal(err)
	}
	for name, test := range map[string]struct {
		command Command
		same    bool
	}{
		"reencoded":       {reencoded, true},
		"changed payload": {changed, false},
		"other authority": {otherAuthority, false},
	} {
		got, err := digest(test.command)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Equal(got, first) != test.same {
			t.Errorf("%s: digest equality = %t, want %t", name, !test.same, test.same)
		}
	}
}

func TestRegistryRejectsInvalidAndDuplicateKinds(t *testing.T) {
	t.Parallel()
	handler := func(context.Context, pgx.Tx, Command) (Result, error) {
		return Succeeded(200, struct{}{}), nil
	}
	initiator := func(command Command) (Principal, bool) {
		return command.Authority, true
	}
	registry := NewRegistry()
	registry.Register("test-command", handler, initiator)
	if _, ok := registry.registration("test-command"); !ok {
		t.Fatal("registered kind not found")
	}
	for name, register := range map[string]func(){
		"duplicate": func() { registry.Register("test-command", handler, initiator) },
		"invalid":   func() { registry.Register("Test_Command", handler, initiator) },
		"nil":       func() { registry.Register("other-command", nil, initiator) },
		"nil initiator": func() {
			registry.Register("third-command", handler, nil)
		},
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s registration did not panic", name)
				}
			}()
			register()
		}()
	}
	var missing *Registry
	if _, ok := missing.registration("test-command"); ok {
		t.Fatal("nil registry found a handler")
	}
}

func TestRejectedTakesTheProblemStatus(t *testing.T) {
	t.Parallel()
	result := Rejected(federationproblem.AuthorityNotFoundError)
	if result.status != 404 {
		t.Fatalf("status = %d", result.status)
	}
}

func TestWireRoundTripPreservesTheCommand(t *testing.T) {
	t.Parallel()
	commandID, _ := dbvalue.NewUUID()
	correlationID, _ := dbvalue.NewUUID()
	command := Command{
		CommandID: commandID, CorrelationID: correlationID,
		Kind: "test-command", Authority: testPrincipal(t),
		AggregateID: "aggregate", Payload: json.RawMessage(`{"a":1}`),
	}
	wire := wireRequest(command)
	if fields := wire.Validate(); len(fields) != 0 {
		t.Fatalf("wire request invalid: %v", fields)
	}
	back, err := FromWire(wire, "usa1")
	if err != nil {
		t.Fatal(err)
	}
	if back.CommandID != command.CommandID ||
		back.CorrelationID != command.CorrelationID ||
		back.Authority != command.Authority || back.SourceTenantID != "usa1" ||
		back.AggregateID != command.AggregateID ||
		!bytes.Equal(back.Payload, command.Payload) {
		t.Fatalf("round trip = %+v, want %+v", back, command)
	}
}
