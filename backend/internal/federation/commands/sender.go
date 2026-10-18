package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// ResultKeyPurpose names the credential subkey that encrypts stored
// outcomes; the API that sends and the workers that recover derive the same
// key for an owner type.
const ResultKeyPurpose = "federation-operation-result"

const (
	operationTTL              = 30 * 24 * time.Hour
	defaultFirstRecoveryDelay = 30 * time.Second
	recoveryBatchSize         = 100
	recoveryActorID           = "federation-commands"
)

// OwnerType is the kind of initiating principal, who alone may read the
// operation's status.
type OwnerType string

const (
	OwnerHubUser OwnerType = "hub_user"
	OwnerOrgUser OwnerType = "org_user"
)

type Owner struct {
	Type OwnerType
	ID   string
}

// Request is one cross-tenant write. The caller has already authorized its
// own user; the authority's Handler authorizes what it owns.
type Request struct {
	Kind      federationspec.CommandKind
	Authority Principal
	// AggregateID, Kind, and IdempotencyKey identify one operation: a repeat
	// replays it rather than sending a new command.
	AggregateID    string
	Owner          Owner
	IdempotencyKey common.IdempotencyKey
	// RequestDigest identifies the caller's request, so reusing its key for
	// a different request is a conflict even though Payload carries ids the
	// caller mints afresh on every call.
	RequestDigest []byte
	// Payload is the replayable logical command, a JSON object. Never put a
	// bearer secret in it.
	Payload any
}

type State int

const (
	// StateSucceeded and StateFailed carry the authority's typed result or
	// deterministic problem in Outcome.Response.
	StateSucceeded State = iota + 1
	StateFailed
	// StatePending means the command may have been sent: answer 202 with a
	// PendingOperation.
	StatePending
	// StateUnavailable means routing or connection setup failed before
	// sending: answer a retryable 503. Nothing happened: the operation was
	// abandoned, so the same idempotency key starts a fresh send.
	StateUnavailable
)

type Outcome struct {
	OperationID pgtype.UUID
	State       State
	Response    Response
}

// ErrIdempotencyConflict reports an idempotency key reused by another owner
// or for a different request.
var ErrIdempotencyConflict = errors.New("federation operation idempotency key conflict")

type SenderConfig struct {
	Pool     *pgxpool.Pool
	TenantID string
	// Source names the process in audit events: hub-api, orgs-api, workers.
	Source   string
	Executor *Executor
	Relay    Relay
	// ResultKeys encrypt stored outcomes, one per owner type this process
	// sends or recovers for.
	ResultKeys map[OwnerType][32]byte
	Log        *slog.Logger
	// FirstRecoveryDelay keeps recovery off an operation while its sender
	// still makes the first attempt; zero means 30 seconds.
	FirstRecoveryDelay time.Duration
	Now                func() time.Time
}

// Sender drives commands from the initiating tenant: it keeps the operation
// ledger, executes in process when this tenant is the authority, and
// otherwise goes through the local mesh relay.
type Sender struct {
	config  SenderConfig
	queries *sqlc.Queries
}

func NewSender(config SenderConfig) *Sender {
	if config.Log == nil {
		config.Log = slog.New(slog.DiscardHandler)
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	if config.FirstRecoveryDelay <= 0 {
		config.FirstRecoveryDelay = defaultFirstRecoveryDelay
	}
	return &Sender{config: config, queries: sqlc.New(config.Pool)}
}

type auditActor struct {
	actorType string
	actorID   string
}

// Send commits the pending operation before any network call, then
// executes the command. Replaying a request returns its stored outcome or
// drives its pending operation again.
//
//vetchium:multiple-commits commits the pending operation before contacting the authority tenant, then records the outcome
func (s *Sender) Send(ctx context.Context, request Request) (Outcome, error) {
	if err := s.validate(request); err != nil {
		return Outcome{}, err
	}
	existing, err := s.queries.GetFederationOperationByIdempotency(ctx,
		sqlc.GetFederationOperationByIdempotencyParams{
			Kind: string(request.Kind), AggregateID: request.AggregateID,
			IdempotencyKey: string(request.IdempotencyKey),
		})
	if err == nil {
		return s.replay(ctx, existing, request)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Outcome{}, fmt.Errorf("find federation operation: %w", err)
	}
	payload, err := json.Marshal(request.Payload)
	if err != nil {
		return Outcome{}, fmt.Errorf("encode federation command payload: %w", err)
	}
	if !federationspec.IsJSONObject(payload) {
		return Outcome{}, fmt.Errorf("federation command payload is not an object")
	}
	operationID, err := dbvalue.NewUUID()
	if err != nil {
		return Outcome{}, err
	}
	commandID, err := dbvalue.NewUUID()
	if err != nil {
		return Outcome{}, err
	}
	now := s.config.Now()
	tx, err := s.config.Pool.Begin(ctx)
	if err != nil {
		return Outcome{}, fmt.Errorf("begin federation operation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if _, err := q.DeleteExpiredFederationCommandOperation(ctx,
		sqlc.DeleteExpiredFederationCommandOperationParams{
			Kind: string(request.Kind), AggregateID: request.AggregateID,
			IdempotencyKey: string(request.IdempotencyKey),
			TenantID:       s.config.TenantID,
			ActorType:      string(request.Owner.Type),
			ActorID:        dbvalue.Text(request.Owner.ID),
			Source:         s.config.Source,
		}); err != nil {
		return Outcome{}, fmt.Errorf("delete expired federation operation: %w", err)
	}
	row, err := q.CreateFederationCommandOperation(ctx,
		sqlc.CreateFederationCommandOperationParams{
			OperationID: operationID, CommandID: commandID,
			Kind: string(request.Kind), AggregateID: request.AggregateID,
			OwnerPrincipalType: string(request.Owner.Type),
			OwnerPrincipalID:   request.Owner.ID,
			IdempotencyKey:     string(request.IdempotencyKey),
			RequestDigest:      request.RequestDigest, PayloadBytes: payload,
			NextAttemptAt: dbvalue.Timestamp(
				now.Add(s.config.FirstRecoveryDelay),
			),
			ExpiresAt: dbvalue.Timestamp(now.Add(operationTTL)),
			AuthorityPrincipalType: dbvalue.Text(
				string(request.Authority.Type),
			),
			AuthorityPrincipalDid: request.Authority.DID,
			TenantID:              s.config.TenantID, Source: s.config.Source,
		})
	if isIdempotencyRace(err) {
		_ = tx.Rollback(ctx)
		existing, err := s.queries.GetFederationOperationByIdempotency(ctx,
			sqlc.GetFederationOperationByIdempotencyParams{
				Kind: string(request.Kind), AggregateID: request.AggregateID,
				IdempotencyKey: string(request.IdempotencyKey),
			})
		if err != nil {
			return Outcome{}, fmt.Errorf("reload federation operation: %w", err)
		}
		return s.replay(ctx, existing, request)
	}
	if err != nil {
		return Outcome{}, fmt.Errorf("create federation operation: %w", err)
	}
	operation := sqlc.VetchiumFederationOperation(row)
	actor := auditActor{
		actorType: string(request.Owner.Type), actorID: request.Owner.ID,
	}
	command, err := s.command(operation)
	if err != nil {
		return Outcome{}, err
	}
	// A local authority executes in this transaction, so the operation is
	// created and resolved together and never left pending.
	response, err := s.config.Executor.executeInTx(ctx, tx, command)
	if errors.Is(err, ErrMisdirected) {
		if err := tx.Commit(ctx); err != nil {
			return Outcome{}, fmt.Errorf("commit federation operation: %w", err)
		}
		return s.deliver(ctx, operation, command, actor, true)
	}
	if err != nil {
		return Outcome{}, err
	}
	outcome, err := s.resolve(ctx, q, operation, response, actor)
	if err != nil {
		return Outcome{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Outcome{}, fmt.Errorf("commit federation operation: %w", err)
	}
	return outcome, nil
}

// Recover re-drives due pending operations of every kind. Each attempt is
// recorded, with backoff, before it is sent, so an unreachable authority
// never holds the front of the queue. It returns how many it resolved.
//
//vetchium:multiple-commits commits each operation's attempt before contacting its authority tenant
func (s *Sender) Recover(ctx context.Context) (int, error) {
	operations, err := s.queries.ListRecoverableFederationCommands(
		ctx, recoveryBatchSize,
	)
	if err != nil {
		return 0, fmt.Errorf("list recoverable federation commands: %w", err)
	}
	actor := auditActor{actorType: "worker", actorID: recoveryActorID}
	resolved := 0
	var failures []error
	for _, operation := range operations {
		updated, err := s.queries.RecordFederationOperationRetry(ctx,
			sqlc.RecordFederationOperationRetryParams{
				OperationID: operation.OperationID,
				LastError:   "federation command outcome unknown",
				TenantID:    s.config.TenantID, ActorType: actor.actorType,
				ActorID: dbvalue.Text(actor.actorID), Source: s.config.Source,
			})
		if err != nil {
			failures = append(failures, fmt.Errorf(
				"record federation operation %s attempt: %w",
				dbvalue.FormatUUID(operation.OperationID), err,
			))
			continue
		}
		if updated != 1 {
			continue
		}
		outcome, err := s.drive(ctx, operation, actor)
		if err != nil {
			failures = append(failures, fmt.Errorf(
				"recover federation operation %s: %w",
				dbvalue.FormatUUID(operation.OperationID), err,
			))
			continue
		}
		if outcome.State == StateSucceeded || outcome.State == StateFailed {
			resolved++
		}
	}
	return resolved, errors.Join(failures...)
}

func (s *Sender) validate(request Request) error {
	if !federationspec.IsCommandKind(request.Kind) ||
		!request.Authority.valid() || request.AggregateID == "" ||
		(request.Owner.Type != OwnerHubUser &&
			request.Owner.Type != OwnerOrgUser) ||
		request.Owner.ID == "" ||
		!common.IsIdempotencyKey(request.IdempotencyKey) ||
		len(request.RequestDigest) != 32 {
		return fmt.Errorf("invalid federation command request for %q", request.Kind)
	}
	if _, ok := s.config.ResultKeys[request.Owner.Type]; !ok {
		return fmt.Errorf("no federation result key for %s owners", request.Owner.Type)
	}
	return nil
}

func (s *Sender) replay(
	ctx context.Context, operation sqlc.VetchiumFederationOperation,
	request Request,
) (Outcome, error) {
	if operation.TargetAuthority != "tenant" ||
		operation.OwnerPrincipalType != string(request.Owner.Type) ||
		operation.OwnerPrincipalID != request.Owner.ID ||
		!bytes.Equal(operation.RequestDigest, request.RequestDigest) {
		return Outcome{}, ErrIdempotencyConflict
	}
	if operation.State != sqlc.VetchiumFederationOperationStatePending {
		return s.stored(operation)
	}
	actor := auditActor{
		actorType: string(request.Owner.Type), actorID: request.Owner.ID,
	}
	// Recorded before sending, like a recovery attempt, so the sender's
	// first attempt can no longer abandon an operation this one may send.
	updated, err := s.queries.RecordFederationOperationRetry(ctx,
		sqlc.RecordFederationOperationRetryParams{
			OperationID: operation.OperationID,
			LastError:   "federation command replayed while pending",
			TenantID:    s.config.TenantID, ActorType: actor.actorType,
			ActorID: dbvalue.Text(actor.actorID), Source: s.config.Source,
		})
	if err != nil {
		return Outcome{}, fmt.Errorf("record federation operation attempt: %w", err)
	}
	if updated != 1 {
		current, err := s.queries.GetFederationOperation(ctx, operation.OperationID)
		if err != nil {
			return Outcome{}, fmt.Errorf("reload federation operation: %w", err)
		}
		return s.stored(current)
	}
	return s.drive(ctx, operation, actor)
}

// drive attempts a pending operation: in process when this tenant now homes
// the authority, otherwise through the relay.
func (s *Sender) drive(
	ctx context.Context, operation sqlc.VetchiumFederationOperation,
	actor auditActor,
) (Outcome, error) {
	command, err := s.command(operation)
	if err != nil {
		return Outcome{}, err
	}
	tx, err := s.config.Pool.Begin(ctx)
	if err != nil {
		return Outcome{}, fmt.Errorf("begin federation operation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	response, err := s.config.Executor.executeInTx(ctx, tx, command)
	if errors.Is(err, ErrMisdirected) {
		_ = tx.Rollback(ctx)
		return s.deliver(ctx, operation, command, actor, false)
	}
	if err != nil {
		return Outcome{}, err
	}
	outcome, err := s.resolve(ctx, sqlc.New(tx), operation, response, actor)
	if err != nil {
		return Outcome{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Outcome{}, fmt.Errorf("commit federation operation: %w", err)
	}
	return outcome, nil
}

// deliver sends through the relay. first marks the sender's own attempt
// right after creating the operation, the only one that may abandon it.
func (s *Sender) deliver(
	ctx context.Context, operation sqlc.VetchiumFederationOperation,
	command Command, actor auditActor, first bool,
) (Outcome, error) {
	response, err := s.config.Relay.Execute(ctx, wireRequest(command))
	if errors.Is(err, ErrNotSent) {
		s.config.Log.Warn("federation command not sent",
			"event", "federation_command_not_sent",
			"operationID", dbvalue.FormatUUID(operation.OperationID),
			"kind", operation.Kind, "error", err)
		if first && s.abandon(ctx, operation, actor) {
			return Outcome{
				OperationID: operation.OperationID, State: StateUnavailable,
			}, nil
		}
		// An earlier or concurrent attempt may have been sent.
		return Outcome{
			OperationID: operation.OperationID, State: StatePending,
		}, nil
	}
	if err != nil {
		s.config.Log.Warn("federation command outcome unknown",
			"event", "federation_command_pending",
			"operationID", dbvalue.FormatUUID(operation.OperationID),
			"kind", operation.Kind, "error", err)
		return Outcome{
			OperationID: operation.OperationID, State: StatePending,
		}, nil
	}
	return s.resolve(ctx, s.queries, operation, response, actor)
}

// abandon removes an operation that was certainly never sent, releasing its
// idempotency key, so the retryable answer means nothing happened. It fails
// when another attempt was recorded, which may have sent the command.
func (s *Sender) abandon(
	ctx context.Context, operation sqlc.VetchiumFederationOperation,
	actor auditActor,
) bool {
	removed, err := s.queries.AbandonUnsentFederationOperation(ctx,
		sqlc.AbandonUnsentFederationOperationParams{
			OperationID: operation.OperationID, TenantID: s.config.TenantID,
			ActorType: actor.actorType, ActorID: dbvalue.Text(actor.actorID),
			Source: s.config.Source,
		})
	if err != nil {
		s.config.Log.Warn("federation operation not abandoned",
			"event", "federation_command_abandon_failed",
			"operationID", dbvalue.FormatUUID(operation.OperationID),
			"kind", operation.Kind, "error", err)
		return false
	}
	return removed == 1
}

// resolve records a definite outcome. If another driver already resolved
// the operation, its stored outcome wins; both came from the same command
// result at the authority.
func (s *Sender) resolve(
	ctx context.Context, q *sqlc.Queries,
	operation sqlc.VetchiumFederationOperation, response Response,
	actor auditActor,
) (Outcome, error) {
	key, ok := s.config.ResultKeys[OwnerType(operation.OwnerPrincipalType)]
	if !ok {
		return Outcome{}, fmt.Errorf(
			"no federation result key for %s owners", operation.OwnerPrincipalType,
		)
	}
	ciphertext, err := credentials.Encrypt(key, response.Body)
	if err != nil {
		return Outcome{}, err
	}
	state := StateFailed
	operationState := sqlc.VetchiumFederationOperationStateFailed
	if response.succeeded() {
		state = StateSucceeded
		operationState = sqlc.VetchiumFederationOperationStateSucceeded
	}
	_, err = q.ResolveFederationOperation(ctx,
		sqlc.ResolveFederationOperationParams{
			OperationID: operation.OperationID, State: operationState,
			ResponseStatus: pgtype.Int4{
				Int32: int32(response.Status), Valid: true,
			},
			ResponseCiphertext: ciphertext, TenantID: s.config.TenantID,
			ActorType: actor.actorType, ActorID: dbvalue.Text(actor.actorID),
			Source: s.config.Source,
		})
	if errors.Is(err, pgx.ErrNoRows) {
		current, err := q.GetFederationOperation(ctx, operation.OperationID)
		if err != nil {
			return Outcome{}, fmt.Errorf("reload federation operation: %w", err)
		}
		return s.stored(current)
	}
	if err != nil {
		return Outcome{}, fmt.Errorf("resolve federation operation: %w", err)
	}
	return Outcome{
		OperationID: operation.OperationID, State: state, Response: response,
	}, nil
}

func (s *Sender) stored(operation sqlc.VetchiumFederationOperation) (Outcome, error) {
	if operation.State == sqlc.VetchiumFederationOperationStatePending {
		return Outcome{OperationID: operation.OperationID, State: StatePending}, nil
	}
	key, ok := s.config.ResultKeys[OwnerType(operation.OwnerPrincipalType)]
	if !ok {
		return Outcome{}, fmt.Errorf(
			"no federation result key for %s owners", operation.OwnerPrincipalType,
		)
	}
	body, err := credentials.Decrypt(key, operation.ResponseCiphertext)
	if err != nil {
		return Outcome{}, fmt.Errorf("decrypt federation outcome: %w", err)
	}
	state := StateFailed
	if operation.State == sqlc.VetchiumFederationOperationStateSucceeded {
		state = StateSucceeded
	}
	return Outcome{
		OperationID: operation.OperationID, State: state,
		Response: Response{
			Status: int(operation.ResponseStatus.Int32), Body: body,
		},
	}, nil
}

func (s *Sender) command(operation sqlc.VetchiumFederationOperation) (Command, error) {
	if operation.TargetAuthority != "tenant" ||
		!operation.AuthorityPrincipalType.Valid ||
		!operation.AuthorityPrincipalDid.Valid {
		return Command{}, fmt.Errorf("federation operation %s is not a tenant command",
			dbvalue.FormatUUID(operation.OperationID))
	}
	return Command{
		CommandID: operation.CommandID, CorrelationID: operation.OperationID,
		SourceTenantID: s.config.TenantID,
		Kind:           federationspec.CommandKind(operation.Kind),
		Authority: Principal{
			Type: directoryspec.PrincipalType(
				operation.AuthorityPrincipalType.String,
			),
			DID: operation.AuthorityPrincipalDid,
		},
		AggregateID: operation.AggregateID, Payload: operation.PayloadBytes,
	}, nil
}

func isIdempotencyRace(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) &&
		databaseError.Code == "23505" &&
		databaseError.ConstraintName == "federation_operations_idempotency_key"
}
