package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/problem"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// Locator decides whether this tenant homes a principal.
type Locator interface {
	IsLocal(context.Context, *sqlc.Queries, Principal) (bool, error)
}

// DatabaseLocator treats a principal row in this tenant's database as proof
// that this tenant is its home.
type DatabaseLocator struct{}

func (DatabaseLocator) IsLocal(
	ctx context.Context, q *sqlc.Queries, principal Principal,
) (bool, error) {
	return q.IsLocalFederationPrincipal(ctx,
		sqlc.IsLocalFederationPrincipalParams{
			PrincipalType: string(principal.Type),
			PrincipalDid:  principal.DID,
		})
}

// PrincipalDirectory is the global directory's resolve-principal;
// directoryclient.Client satisfies it.
type PrincipalDirectory interface {
	ResolvePrincipal(
		context.Context, directoryspec.ResolvePrincipalRequest,
	) (directoryspec.ResolvePrincipalResponse, *problem.Details, error)
}

type ExecutorConfig struct {
	Pool     *pgxpool.Pool
	TenantID string
	Registry *Registry
	// Locator defaults to DatabaseLocator.
	Locator Locator
	// Directory proves where the initiator of a command from another tenant
	// is homed. Only mesh-api, which receives such commands, needs it.
	Directory PrincipalDirectory
}

// Executor runs commands at their authority and keeps the command-result
// ledger, so each command id executes once and replays its stored outcome.
type Executor struct {
	pool      *pgxpool.Pool
	tenantID  string
	registry  *Registry
	locator   Locator
	directory PrincipalDirectory
}

// initiatorHome is where the directory homes a remote command's initiator,
// resolved before the command's transaction opens.
type initiatorHome struct {
	principal Principal
	tenantID  string
	found     bool
	err       error
}

func NewExecutor(config ExecutorConfig) *Executor {
	locator := config.Locator
	if locator == nil {
		locator = DatabaseLocator{}
	}
	return &Executor{
		pool: config.Pool, tenantID: config.TenantID,
		registry: config.Registry, locator: locator,
		directory: config.Directory,
	}
}

// Execute runs command in its own transaction. The initiator of a command
// from another tenant is resolved first, so no transaction is held across
// the directory call.
func (e *Executor) Execute(ctx context.Context, command Command) (Response, error) {
	home := e.resolveInitiator(ctx, command)
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		return Response{}, fmt.Errorf("begin federation command: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	response, err := e.executeInTx(ctx, tx, command, home)
	if err != nil {
		return Response{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Response{}, fmt.Errorf("commit federation command: %w", err)
	}
	return response, nil
}

// resolveInitiator looks up where the directory homes the initiator of a
// command from another tenant. A command from this tenant is checked against
// the local database in its transaction instead.
func (e *Executor) resolveInitiator(
	ctx context.Context, command Command,
) *initiatorHome {
	if command.SourceTenantID == e.tenantID {
		return nil
	}
	entry, ok := e.registry.registration(command.Kind)
	if !ok {
		return nil
	}
	principal, ok := entry.initiator(command)
	if !ok || !principal.valid() {
		return nil
	}
	home := &initiatorHome{principal: principal}
	if e.directory == nil {
		home.err = errors.New("no directory to locate the command initiator")
		return home
	}
	resolved, details, err := e.directory.ResolvePrincipal(ctx,
		directoryspec.ResolvePrincipalRequest{
			PrincipalType: principal.Type,
			PrincipalDID: directoryspec.PrincipalDID(
				dbvalue.FormatUUID(principal.DID),
			),
		})
	switch {
	case err != nil:
		home.err = fmt.Errorf("resolve federation command initiator: %w", err)
	case details != nil &&
		details.Type == coordinatorproblem.DirectoryEntryNotFoundError.Type:
	case details != nil:
		home.err = fmt.Errorf("resolve federation command initiator: %s",
			details.Type)
	default:
		home.tenantID, home.found = string(resolved.HomeTenantID), true
	}
	return home
}

// initiatorHomed reports whether the command's initiator is homed at the
// tenant that sent it: this tenant's database proves a local initiator, the
// directory a remote one.
func (e *Executor) initiatorHomed(
	ctx context.Context, q *sqlc.Queries, command Command,
	initiator Principal, home *initiatorHome,
) (bool, error) {
	if command.SourceTenantID == e.tenantID {
		local, err := e.locator.IsLocal(ctx, q, initiator)
		if err != nil {
			return false, fmt.Errorf("locate federation command initiator: %w", err)
		}
		return local, nil
	}
	if home == nil || home.principal != initiator {
		return false, errors.New("federation command initiator not resolved")
	}
	if home.err != nil {
		return false, home.err
	}
	return home.found && home.tenantID == command.SourceTenantID, nil
}

// executeInTx returns ErrMisdirected before writing anything, so a sender
// may keep tx and route the command elsewhere. home is nil for a command
// from this tenant.
func (e *Executor) executeInTx(
	ctx context.Context, tx pgx.Tx, command Command, home *initiatorHome,
) (Response, error) {
	command.TenantID = e.tenantID
	if !command.Authority.valid() {
		return Response{}, fmt.Errorf("invalid federation command authority")
	}
	q := sqlc.New(tx)
	// Serializes duplicate deliveries of one command, so the ledger read
	// below sees any concurrent first execution.
	if err := q.LockIdempotency(ctx,
		"federation-command:"+dbvalue.FormatUUID(command.CommandID)); err != nil {
		return Response{}, fmt.Errorf("lock federation command: %w", err)
	}
	commandDigest, err := digest(command)
	if err != nil {
		return Response{}, err
	}
	stored, err := q.GetFederationCommandResult(ctx, command.CommandID)
	if err == nil {
		if stored.SourceTenantID != command.SourceTenantID ||
			stored.Kind != string(command.Kind) ||
			stored.AggregateID != command.AggregateID ||
			!bytes.Equal(stored.RequestDigest, commandDigest) {
			return Response{}, ErrCommandConflict
		}
		return Response{
			Status: int(stored.ResponseStatus), Body: stored.ResponseBody,
		}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Response{}, fmt.Errorf("read federation command result: %w", err)
	}
	local, err := e.locator.IsLocal(ctx, q, command.Authority)
	if err != nil {
		return Response{}, fmt.Errorf("locate federation command authority: %w", err)
	}
	if !local {
		return Response{}, ErrMisdirected
	}
	entry, ok := e.registry.registration(command.Kind)
	if !ok {
		return Response{}, ErrUnsupportedKind
	}
	var response Response
	initiator, ok := entry.initiator(command)
	if !ok || !initiator.valid() {
		details := problem.ValidationFailedError
		details.Fields = []string{"payload"}
		response, err = rejection(details)
	} else {
		var homed bool
		homed, err = e.initiatorHomed(ctx, q, command, initiator, home)
		switch {
		case err != nil:
		case homed:
			response, err = runHandler(ctx, tx, entry.handler, command)
		default:
			response, err = rejection(federationproblem.InitiatorMismatchError)
		}
	}
	if err != nil {
		return Response{}, err
	}
	if _, err := q.RecordFederationCommandResult(ctx,
		sqlc.RecordFederationCommandResultParams{
			CommandID: command.CommandID, SourceTenantID: command.SourceTenantID,
			Kind: string(command.Kind), AggregateID: command.AggregateID,
			RequestDigest: commandDigest, ResponseStatus: int32(response.Status),
			ResponseBody: response.Body,
		}); err != nil {
		return Response{}, fmt.Errorf("record federation command result: %w", err)
	}
	return response, nil
}

func rejection(details problem.Details) (Response, error) {
	body, err := json.Marshal(details)
	if err != nil {
		return Response{}, fmt.Errorf("encode federation command rejection: %w", err)
	}
	return Response{Status: details.Status, Body: body}, nil
}

// runHandler keeps the handler's writes only for a success; a rejection's
// writes roll back with its savepoint while the ledger still records it.
func runHandler(
	ctx context.Context, tx pgx.Tx, handler Handler, command Command,
) (Response, error) {
	savepoint, err := tx.Begin(ctx)
	if err != nil {
		return Response{}, fmt.Errorf("begin federation command handler: %w", err)
	}
	defer func() { _ = savepoint.Rollback(ctx) }()
	result, err := handler(ctx, savepoint, command)
	if err != nil {
		return Response{}, fmt.Errorf("federation command %s: %w", command.Kind, err)
	}
	success := result.status >= http.StatusOK &&
		result.status < http.StatusMultipleChoices
	rejection := result.status >= http.StatusBadRequest &&
		result.status < http.StatusInternalServerError
	if !success && !rejection {
		return Response{}, fmt.Errorf(
			"federation command %s returned status %d", command.Kind, result.status,
		)
	}
	body, err := json.Marshal(result.body)
	if err != nil {
		return Response{}, fmt.Errorf("encode federation command result: %w", err)
	}
	if success {
		if err := savepoint.Commit(ctx); err != nil {
			return Response{}, fmt.Errorf("release federation command handler: %w", err)
		}
	}
	return Response{Status: result.status, Body: body}, nil
}
