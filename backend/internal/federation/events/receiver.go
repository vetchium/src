package events

import (
	"bytes"
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	federationspec "github.com/vetchium/src/typespec/federation"

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

type ReceiverConfig struct {
	Pool     *pgxpool.Pool
	TenantID string
	// Source names the process in audit events: mesh-api or workers.
	Source   string
	Registry *Registry
	// Locator defaults to DatabaseLocator.
	Locator Locator
}

// Receiver applies events at their destination tenant and keeps the inbox,
// so each event id is recorded once and an older aggregate version never
// overwrites a newer one.
type Receiver struct {
	config ReceiverConfig
}

func NewReceiver(config ReceiverConfig) *Receiver {
	if config.Locator == nil {
		config.Locator = DatabaseLocator{}
	}
	return &Receiver{config: config}
}

// Receive applies event in its own transaction.
func (r *Receiver) Receive(
	ctx context.Context, event Event,
) (federationspec.EventDeliveryOutcome, error) {
	tx, err := r.config.Pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin federation event: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	outcome, err := r.receiveInTx(ctx, tx, event)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit federation event: %w", err)
	}
	return outcome, nil
}

// receiveInTx writes nothing when it returns an error or a duplicate, so a
// caller may keep tx for its own writes or route the event elsewhere.
func (r *Receiver) receiveInTx(
	ctx context.Context, tx pgx.Tx, event Event,
) (federationspec.EventDeliveryOutcome, error) {
	event.TenantID = r.config.TenantID
	if !event.Destination.valid() {
		return "", fmt.Errorf("invalid federation event destination")
	}
	q := sqlc.New(tx)
	// Serializes duplicate deliveries of one event, so the receipt read
	// below sees any concurrent first delivery.
	if err := q.LockIdempotency(ctx,
		"federation-event:"+dbvalue.FormatUUID(event.EventID)); err != nil {
		return "", fmt.Errorf("lock federation event: %w", err)
	}
	eventDigest, err := digest(event)
	if err != nil {
		return "", err
	}
	receipt, err := q.GetFederationInboxReceipt(ctx, event.EventID)
	if err == nil {
		if receipt.SourceTenantID != event.SourceTenantID ||
			receipt.Kind != string(event.Kind) ||
			receipt.AggregateType != string(event.AggregateType) ||
			receipt.AggregateID != event.AggregateID ||
			receipt.AggregateVersion != event.AggregateVersion ||
			!bytes.Equal(receipt.PayloadDigest, eventDigest) {
			return "", ErrEventConflict
		}
		return federationspec.EventDuplicate, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("read federation inbox receipt: %w", err)
	}
	local, err := r.config.Locator.IsLocal(ctx, q, event.Destination)
	if err != nil {
		return "", fmt.Errorf("locate federation event destination: %w", err)
	}
	if !local {
		return "", ErrMisdirected
	}
	handler, ok := r.config.Registry.handler(event.Kind)
	if !ok {
		return "", ErrUnsupportedKind
	}
	applied := true
	if _, err := q.AdvanceFederationEventWatermark(ctx,
		sqlc.AdvanceFederationEventWatermarkParams{
			Kind:                    string(event.Kind),
			DestinationPrincipalDid: event.Destination.DID,
			AggregateType:           string(event.AggregateType),
			AggregateID:             event.AggregateID,
			AggregateVersion:        event.AggregateVersion,
		}); errors.Is(err, pgx.ErrNoRows) {
		applied = false
	} else if err != nil {
		return "", fmt.Errorf("advance federation event watermark: %w", err)
	}
	if applied {
		if err := handler(ctx, tx, event); err != nil {
			return "", fmt.Errorf("federation event %s: %w", event.Kind, err)
		}
	}
	if err := q.RecordFederationInboxReceipt(ctx,
		sqlc.RecordFederationInboxReceiptParams{
			TenantID: r.config.TenantID, Source: r.config.Source,
			EventID: event.EventID, SourceTenantID: event.SourceTenantID,
			Kind:          string(event.Kind),
			AggregateType: string(event.AggregateType),
			AggregateID:   event.AggregateID, AggregateVersion: event.AggregateVersion,
			PayloadDigest: eventDigest, Applied: applied,
		}); err != nil {
		return "", fmt.Errorf("record federation inbox receipt: %w", err)
	}
	if !applied {
		return federationspec.EventSuperseded, nil
	}
	return federationspec.EventApplied, nil
}
