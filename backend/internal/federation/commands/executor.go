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

type ExecutorConfig struct {
	Pool     *pgxpool.Pool
	TenantID string
	Registry *Registry
	// Locator defaults to DatabaseLocator.
	Locator Locator
}

// Executor runs commands at their authority and keeps the command-result
// ledger, so each command id executes once and replays its stored outcome.
type Executor struct {
	pool     *pgxpool.Pool
	tenantID string
	registry *Registry
	locator  Locator
}

func NewExecutor(config ExecutorConfig) *Executor {
	locator := config.Locator
	if locator == nil {
		locator = DatabaseLocator{}
	}
	return &Executor{
		pool: config.Pool, tenantID: config.TenantID,
		registry: config.Registry, locator: locator,
	}
}

// Execute runs command in its own transaction.
func (e *Executor) Execute(ctx context.Context, command Command) (Response, error) {
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		return Response{}, fmt.Errorf("begin federation command: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	response, err := e.executeInTx(ctx, tx, command)
	if err != nil {
		return Response{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Response{}, fmt.Errorf("commit federation command: %w", err)
	}
	return response, nil
}

// executeInTx returns ErrMisdirected before writing anything, so a sender
// may keep tx and route the command elsewhere.
func (e *Executor) executeInTx(
	ctx context.Context, tx pgx.Tx, command Command,
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
	handler, ok := e.registry.handler(command.Kind)
	if !ok {
		return Response{}, ErrUnsupportedKind
	}
	response, err := runHandler(ctx, tx, handler, command)
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
