package events

import (
	"bytes"
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"
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

type ReceiverConfig struct {
	Pool     *pgxpool.Pool
	TenantID string
	// Source names the process in audit events: mesh-api or workers.
	Source   string
	Registry *Registry
	// Locator defaults to DatabaseLocator.
	Locator Locator
	// Directory proves where the origin of an event from another tenant is
	// homed. Only mesh-api, which receives such events, needs it.
	Directory PrincipalDirectory
}

// originHome is where the directory homes a remote event's origin, resolved
// before the receiving transaction opens.
type originHome struct {
	principal Principal
	tenantID  string
	found     bool
	err       error
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

// Receive applies event in its own transaction. The origin of an event from
// another tenant is resolved first, so no transaction is held across the
// directory call.
func (r *Receiver) Receive(
	ctx context.Context, event Event,
) (federationspec.EventDeliveryOutcome, error) {
	home := r.resolveOrigin(ctx, event)
	tx, err := r.config.Pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin federation event: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	outcome, err := r.receiveInTx(ctx, tx, event, home)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit federation event: %w", err)
	}
	return outcome, nil
}

// resolveOrigin looks up where the directory homes the origin of an event
// from another tenant. An event from this tenant is checked against the
// local database in its transaction instead.
func (r *Receiver) resolveOrigin(ctx context.Context, event Event) *originHome {
	if event.SourceTenantID == r.config.TenantID {
		return nil
	}
	entry, ok := r.config.Registry.registration(event.Kind)
	if !ok {
		return nil
	}
	principal, ok := entry.origin(event)
	if !ok || !principal.valid() {
		return nil
	}
	home := &originHome{principal: principal}
	if r.config.Directory == nil {
		home.err = errors.New("no directory to locate the event origin")
		return home
	}
	resolved, details, err := r.config.Directory.ResolvePrincipal(ctx,
		directoryspec.ResolvePrincipalRequest{
			PrincipalType: principal.Type,
			PrincipalDID: directoryspec.PrincipalDID(
				dbvalue.FormatUUID(principal.DID),
			),
		})
	switch {
	case err != nil:
		home.err = fmt.Errorf("resolve federation event origin: %w", err)
	case details != nil &&
		details.Type == coordinatorproblem.DirectoryEntryNotFoundError.Type:
	case details != nil:
		home.err = fmt.Errorf("resolve federation event origin: %s",
			details.Type)
	default:
		home.tenantID, home.found = string(resolved.HomeTenantID), true
	}
	return home
}

// originHomed reports whether the event's origin is homed at the tenant
// that sent it: this tenant's database proves a local origin, the directory
// a remote one.
func (r *Receiver) originHomed(
	ctx context.Context, q *sqlc.Queries, event Event, entry registration,
	home *originHome,
) error {
	origin, ok := entry.origin(event)
	if !ok || !origin.valid() {
		return fmt.Errorf("federation event %s names no origin", event.Kind)
	}
	if event.SourceTenantID == r.config.TenantID {
		local, err := r.config.Locator.IsLocal(ctx, q, origin)
		if err != nil {
			return fmt.Errorf("locate federation event origin: %w", err)
		}
		if !local {
			return ErrOriginMismatch
		}
		return nil
	}
	if home == nil || home.principal != origin {
		return errors.New("federation event origin not resolved")
	}
	if home.err != nil {
		return home.err
	}
	if !home.found || home.tenantID != event.SourceTenantID {
		return ErrOriginMismatch
	}
	return nil
}

// receiveInTx writes nothing when it returns an error or a duplicate, so a
// caller may keep tx for its own writes or route the event elsewhere. home is
// nil for an event from this tenant.
func (r *Receiver) receiveInTx(
	ctx context.Context, tx pgx.Tx, event Event, home *originHome,
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
	entry, ok := r.config.Registry.registration(event.Kind)
	if !ok {
		return "", ErrUnsupportedKind
	}
	if err := r.originHomed(ctx, q, event, entry, home); err != nil {
		return "", err
	}
	applied := true
	if _, err := q.AdvanceFederationEventWatermark(ctx,
		sqlc.AdvanceFederationEventWatermarkParams{
			Kind:                    string(entry.watermarkKind),
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
		if err := entry.handler(ctx, tx, event); err != nil {
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
