// Package commands sends durable commands from an initiating tenant to the
// home tenant of an aggregate's authority principal, and executes them there
// exactly once (agent-guides/federation.md, Durable cross-tenant commands).
//
// A feature registers a Kind and its Handler in commandkinds.Registry; the
// initiating API calls Sender.Send. The operation ledger, routing, transport,
// replay, and recovery are all here, so no feature carries its own
// reliability protocol.
package commands

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/dbvalue"
	"backend/internal/federation/meshwire"
)

// Principal is the Hub user or Org whose home tenant is the authority for
// the command's aggregate.
type Principal struct {
	Type directoryspec.PrincipalType
	DID  pgtype.UUID
}

func (p Principal) valid() bool {
	return directoryspec.IsPrincipal(
		p.Type, directoryspec.PrincipalDID(dbvalue.FormatUUID(p.DID)),
	)
}

// Command is what an authority's Handler executes. Every attempt of one
// command carries identical values.
type Command struct {
	CommandID     pgtype.UUID
	CorrelationID pgtype.UUID
	// SourceTenantID is the initiating tenant, from its mesh certificate or,
	// in process, this tenant.
	SourceTenantID string
	// TenantID is the executing (authority) tenant.
	TenantID    string
	Kind        federationspec.CommandKind
	Authority   Principal
	AggregateID string
	Payload     json.RawMessage
}

// Result is a Handler's typed outcome. Build it with Succeeded or Rejected.
type Result struct {
	status int
	body   any
}

// Succeeded commits the handler's writes and stores body as the result.
func Succeeded(status int, body any) Result {
	return Result{status: status, body: body}
}

// Rejected rolls back the handler's writes and stores the problem as the
// command's deterministic outcome; a replay returns it again.
func Rejected(details problem.Body) Result {
	return Result{status: details.ProblemDetails().Status, body: details}
}

// Handler executes one command kind at its authority, writing through
// sqlc.New(tx). Its writes, including audit and outbox events, commit in the
// same transaction as the command result; a returned error rolls everything
// back.
type Handler func(context.Context, pgx.Tx, Command) (Result, error)

// Registry maps command kinds to their authority handlers.
type Registry struct {
	handlers map[federationspec.CommandKind]Handler
}

func NewRegistry() *Registry {
	return &Registry{handlers: map[federationspec.CommandKind]Handler{}}
}

// Register panics on an invalid or duplicate kind: both are programming
// errors found at startup.
func (r *Registry) Register(kind federationspec.CommandKind, handler Handler) {
	if !federationspec.IsCommandKind(kind) || handler == nil {
		panic(fmt.Sprintf("invalid federation command registration %q", kind))
	}
	if _, exists := r.handlers[kind]; exists {
		panic(fmt.Sprintf("duplicate federation command kind %q", kind))
	}
	r.handlers[kind] = handler
}

func (r *Registry) handler(kind federationspec.CommandKind) (Handler, bool) {
	if r == nil {
		return nil, false
	}
	handler, ok := r.handlers[kind]
	return handler, ok
}

// Response is a command's stored outcome: a 2xx typed result or a 4xx
// problem, as JSON.
type Response struct {
	Status int
	Body   json.RawMessage
}

func (r Response) succeeded() bool {
	return r.Status >= http.StatusOK && r.Status < http.StatusMultipleChoices
}

var (
	// ErrCommandConflict reports a command id reused for another command.
	ErrCommandConflict = errors.New("federation command id reused for another command")
	// ErrMisdirected reports an authority principal this tenant does not
	// home; nothing ran.
	ErrMisdirected = errors.New("federation command authority not homed here")
	// ErrUnsupportedKind reports a kind this tenant has no handler for;
	// nothing ran.
	ErrUnsupportedKind = errors.New("federation command kind not supported")
	// ErrNotSent reports a routing or connection failure before the command
	// was transmitted.
	ErrNotSent = meshwire.ErrNotSent
	// ErrOutcomeUnknown reports a command that may have been transmitted
	// without a definite outcome coming back.
	ErrOutcomeUnknown = meshwire.ErrOutcomeUnknown
)

// digest identifies a command's content at the authority. The payload is
// re-encoded canonically (sorted keys, encoding/json escaping) so relaying
// it never changes the digest.
func digest(command Command) ([]byte, error) {
	canonical, err := meshwire.Canonical(command.Payload)
	if err != nil {
		return nil, err
	}
	sum := sha256.New()
	sum.Write([]byte(string(command.Authority.Type) + "\x00" +
		dbvalue.FormatUUID(command.Authority.DID) + "\x00"))
	sum.Write(canonical)
	return sum.Sum(nil), nil
}

// wireRequest is the mesh representation of command.
func wireRequest(command Command) federationspec.ExecuteCommandRequest {
	return federationspec.ExecuteCommandRequest{
		CommandID: directoryspec.CommandID(
			dbvalue.FormatUUID(command.CommandID),
		),
		CorrelationID: directoryspec.CommandID(
			dbvalue.FormatUUID(command.CorrelationID),
		),
		Kind:                   command.Kind,
		AuthorityPrincipalType: command.Authority.Type,
		AuthorityPrincipalDID: directoryspec.PrincipalDID(
			dbvalue.FormatUUID(command.Authority.DID),
		),
		AggregateID: command.AggregateID,
		Payload:     command.Payload,
	}
}

// FromWire converts a validated mesh request into the command an Executor
// runs for sourceTenantID.
func FromWire(
	request federationspec.ExecuteCommandRequest, sourceTenantID string,
) (Command, error) {
	commandID, err := dbvalue.ParseUUID(string(request.CommandID))
	if err != nil {
		return Command{}, err
	}
	correlationID, err := dbvalue.ParseUUID(string(request.CorrelationID))
	if err != nil {
		return Command{}, err
	}
	did, err := dbvalue.ParseUUID(string(request.AuthorityPrincipalDID))
	if err != nil {
		return Command{}, err
	}
	return Command{
		CommandID: commandID, CorrelationID: correlationID,
		SourceTenantID: sourceTenantID, Kind: request.Kind,
		Authority: Principal{
			Type: request.AuthorityPrincipalType, DID: did,
		},
		AggregateID: request.AggregateID, Payload: request.Payload,
	}, nil
}

// WireResult is the mesh representation of a stored outcome.
func WireResult(response Response) federationspec.CommandResult {
	return federationspec.CommandResult{
		Status: int32(response.Status), Body: response.Body,
	}
}
