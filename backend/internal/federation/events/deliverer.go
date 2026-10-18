package events

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
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

const (
	deliveryBatchSize = 100
	// A lease outlives any one attempt, bounded by the relay timeout, so it
	// only expires after a worker stopped mid-delivery.
	defaultLeaseTTL = time.Minute
	// Retries back off to five minutes; from this attempt on, about twenty
	// minutes after the first, every failure is logged for alerting.
	stalledAttempts = 10
)

type DelivererConfig struct {
	Pool     *pgxpool.Pool
	TenantID string
	// Receiver applies events whose destination this tenant homes, in the
	// transaction that completes them.
	Receiver *Receiver
	Relay    Relay
	Log      *slog.Logger
	// LeaseTTL defaults to one minute.
	LeaseTTL time.Duration
	Now      func() time.Time
}

// Deliverer drains this tenant's outbox: at least once, with bounded
// exponential backoff, to the destination principal's home tenant.
type Deliverer struct {
	config  DelivererConfig
	queries *sqlc.Queries
}

func NewDeliverer(config DelivererConfig) *Deliverer {
	if config.Log == nil {
		config.Log = slog.New(slog.DiscardHandler)
	}
	if config.LeaseTTL <= 0 {
		config.LeaseTTL = defaultLeaseTTL
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	return &Deliverer{config: config, queries: sqlc.New(config.Pool)}
}

// Deliver attempts up to one batch of due events and returns how many were
// delivered. A failed attempt is scheduled for retry, not returned as an
// error; errors are database failures.
//
//vetchium:multiple-commits commits each event's lease before contacting its destination tenant, then records the outcome
func (d *Deliverer) Deliver(ctx context.Context) (int, error) {
	delivered := 0
	for range deliveryBatchSize {
		done, attempted, err := d.deliverNext(ctx)
		if err != nil {
			return delivered, err
		}
		if !attempted {
			return delivered, nil
		}
		if done {
			delivered++
		}
	}
	return delivered, nil
}

// deliverNext reports whether it delivered an event and whether there was
// one to attempt.
func (d *Deliverer) deliverNext(ctx context.Context) (bool, bool, error) {
	leaseToken, err := dbvalue.NewUUID()
	if err != nil {
		return false, false, err
	}
	row, err := d.queries.ClaimFederationOutboxEvent(ctx,
		sqlc.ClaimFederationOutboxEventParams{
			LeaseToken: leaseToken,
			LeasedUntil: dbvalue.Timestamp(
				d.config.Now().Add(d.config.LeaseTTL),
			),
			TenantID: d.config.TenantID,
		})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, nil
	}
	if err != nil {
		return false, false, fmt.Errorf("claim federation event: %w", err)
	}
	event := Event{
		EventID: row.EventID, SourceTenantID: d.config.TenantID,
		Kind: federationspec.EventKind(row.Kind),
		Destination: Principal{
			Type: directoryspec.PrincipalType(row.DestinationPrincipalType),
			DID:  row.DestinationPrincipalDid,
		},
		AggregateType:    federationspec.AggregateType(row.AggregateType),
		AggregateID:      row.AggregateID,
		AggregateVersion: row.AggregateVersion,
		Payload:          row.PayloadBytes,
	}
	claim := claimed{row: row, leaseToken: leaseToken}
	local, done, err := d.deliverLocally(ctx, event, claim)
	if local || err != nil {
		return done, true, err
	}
	delivery, err := d.config.Relay.Deliver(ctx, wireRequest(event))
	switch {
	case err != nil:
		return false, true, d.retry(ctx, claim, err.Error())
	case delivery.Receipt != nil:
		return true, true, d.complete(
			ctx, d.queries, claim, delivery.Receipt.Outcome,
		)
	case delivery.Problem != nil &&
		delivery.Problem.Type == federationproblem.EventConflictError.Type:
		return false, true, d.fail(ctx, claim, "event id conflict at destination")
	case delivery.Problem != nil && delivery.Problem.Type ==
		federationproblem.DestinationNotFoundError.Type:
		return false, true, d.fail(ctx, claim, "destination principal not found")
	default:
		return false, true, d.retry(ctx, claim, "relay gave no definite answer")
	}
}

type claimed struct {
	row        sqlc.ClaimFederationOutboxEventRow
	leaseToken pgtype.UUID
}

// deliverLocally applies an event this tenant homes and completes it in one
// transaction, or schedules its retry. local is false, with nothing
// written, for a destination homed elsewhere.
func (d *Deliverer) deliverLocally(
	ctx context.Context, event Event, claim claimed,
) (local bool, delivered bool, err error) {
	tx, err := d.config.Pool.Begin(ctx)
	if err != nil {
		return true, false, fmt.Errorf("begin federation event: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	outcome, err := d.config.Receiver.receiveInTx(ctx, tx, event)
	switch {
	case errors.Is(err, ErrMisdirected):
		return false, false, nil
	case errors.Is(err, ErrEventConflict):
		_ = tx.Rollback(ctx)
		return true, false, d.fail(ctx, claim, "event id conflict at destination")
	case err != nil:
		_ = tx.Rollback(ctx)
		return true, false, d.retry(ctx, claim, err.Error())
	}
	if err := d.complete(ctx, sqlc.New(tx), claim, outcome); err != nil {
		return true, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return true, false, fmt.Errorf("commit federation event: %w", err)
	}
	return true, true, nil
}

func (d *Deliverer) complete(
	ctx context.Context, q *sqlc.Queries, claim claimed,
	outcome federationspec.EventDeliveryOutcome,
) error {
	rows, err := q.CompleteFederationOutboxEvent(ctx,
		sqlc.CompleteFederationOutboxEventParams{
			EventID: claim.row.EventID, LeaseToken: claim.leaseToken,
			TenantID: d.config.TenantID, Outcome: string(outcome),
		})
	if err != nil {
		return fmt.Errorf("complete federation event: %w", err)
	}
	if rows != 1 {
		return fmt.Errorf("federation event %s lease was lost",
			dbvalue.FormatUUID(claim.row.EventID))
	}
	return nil
}

func (d *Deliverer) retry(ctx context.Context, claim claimed, reason string) error {
	level := slog.LevelWarn
	if claim.row.AttemptCount >= stalledAttempts {
		level = slog.LevelError
	}
	d.config.Log.Log(ctx, level, "federation event delivery attempt failed",
		"event", "federation_event_delivery_retry",
		"eventID", dbvalue.FormatUUID(claim.row.EventID),
		"kind", claim.row.Kind, "attempt", claim.row.AttemptCount,
		"stalled", claim.row.AttemptCount >= stalledAttempts,
		"error", reason)
	rows, err := d.queries.RetryFederationOutboxEvent(ctx,
		sqlc.RetryFederationOutboxEventParams{
			LastError: reason, EventID: claim.row.EventID,
			LeaseToken: claim.leaseToken, TenantID: d.config.TenantID,
		})
	if err != nil {
		return fmt.Errorf("schedule federation event retry: %w", err)
	}
	if rows != 1 {
		return fmt.Errorf("federation event %s lease was lost",
			dbvalue.FormatUUID(claim.row.EventID))
	}
	return nil
}

// fail stops delivering an event that no redelivery can deliver.
func (d *Deliverer) fail(ctx context.Context, claim claimed, reason string) error {
	d.config.Log.Error("federation event undeliverable",
		"event", "federation_event_delivery_failed",
		"eventID", dbvalue.FormatUUID(claim.row.EventID),
		"kind", claim.row.Kind, "attempt", claim.row.AttemptCount,
		"error", reason)
	rows, err := d.queries.FailFederationOutboxEvent(ctx,
		sqlc.FailFederationOutboxEventParams{
			LastError: reason, EventID: claim.row.EventID,
			LeaseToken: claim.leaseToken, TenantID: d.config.TenantID,
		})
	if err != nil {
		return fmt.Errorf("fail federation event: %w", err)
	}
	if rows != 1 {
		return fmt.Errorf("federation event %s lease was lost",
			dbvalue.FormatUUID(claim.row.EventID))
	}
	return nil
}
