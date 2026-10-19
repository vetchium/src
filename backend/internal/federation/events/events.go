// Package events carries effects of committed authoritative changes to the
// home tenant of a destination principal through a transactional outbox and
// inbox (agent-guides/federation.md, Transactional outbox and inbox).
//
// A write transaction calls Enqueue beside its state change. A feature
// registers the receiving Kind and its Handler in eventkinds.Registry. The
// workers' Deliverer, the routing, the transport, the inbox receipt, and
// the per-aggregate watermark are all here, so no feature carries its own
// delivery protocol.
package events

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/meshwire"
)

// Principal is the Hub user or Org whose home tenant receives the event.
type Principal struct {
	Type directoryspec.PrincipalType
	DID  pgtype.UUID
}

func (p Principal) valid() bool {
	return directoryspec.IsPrincipal(
		p.Type, directoryspec.PrincipalDID(dbvalue.FormatUUID(p.DID)),
	)
}

// Event is what a receiver's Handler applies. Every delivery of one event
// carries identical values.
type Event struct {
	EventID pgtype.UUID
	// SourceTenantID is the enqueuing tenant, from its mesh certificate or,
	// in process, this tenant.
	SourceTenantID string
	// TenantID is the receiving tenant.
	TenantID         string
	Kind             federationspec.EventKind
	Destination      Principal
	AggregateType    federationspec.AggregateType
	AggregateID      string
	AggregateVersion int64
	Payload          json.RawMessage
}

// Handler applies one event kind at the destination tenant, writing through
// sqlc.New(tx). It runs only for an event newer than every version of its
// aggregate already applied for that kind and destination; its writes
// commit with the inbox receipt, whose audit event covers them, and a
// returned error rolls everything back for a later redelivery.
type Handler func(context.Context, pgx.Tx, Event) error

// Origin names the principal an event reports on at its source, such as the
// Org whose application changed. ok is false when the event names none; the
// receiver then refuses it as an error, redelivered until fixed.
type Origin func(Event) (Principal, bool)

type registration struct {
	handler Handler
	origin  Origin
}

// Registry maps event kinds to their receiver handlers.
type Registry struct {
	kinds map[federationspec.EventKind]registration
}

func NewRegistry() *Registry {
	return &Registry{kinds: map[federationspec.EventKind]registration{}}
}

// Register panics on an invalid or duplicate kind: both are programming
// errors found at startup. The receiver runs handler only once origin's
// principal is proven homed at the tenant that sent the event.
func (r *Registry) Register(
	kind federationspec.EventKind, handler Handler, origin Origin,
) {
	if !federationspec.IsEventKind(kind) || handler == nil || origin == nil {
		panic(fmt.Sprintf("invalid federation event registration %q", kind))
	}
	if _, exists := r.kinds[kind]; exists {
		panic(fmt.Sprintf("duplicate federation event kind %q", kind))
	}
	r.kinds[kind] = registration{handler: handler, origin: origin}
}

func (r *Registry) registration(
	kind federationspec.EventKind,
) (registration, bool) {
	if r == nil {
		return registration{}, false
	}
	entry, ok := r.kinds[kind]
	return entry, ok
}

// Outgoing is one event a write transaction enqueues.
type Outgoing struct {
	Kind        federationspec.EventKind
	Destination Principal
	// AggregateType, AggregateID, and AggregateVersion name the authoritative
	// change. The version must increase with every change of the aggregate
	// the receiver projects; when the changed entity has no version of its
	// own, use a smaller aggregate that does.
	AggregateType    federationspec.AggregateType
	AggregateID      string
	AggregateVersion int64
	// Payload is the kind's JSON object. Never put a secret in it.
	Payload any
}

// Enqueue inserts the event into the outbox through q, which must run in the
// transaction that commits the change it reports and that change's audit
// event. Delivery starts once that transaction commits.
func Enqueue(ctx context.Context, q sqlc.Querier, event Outgoing) (pgtype.UUID, error) {
	if !federationspec.IsEventKind(event.Kind) || !event.Destination.valid() ||
		!federationspec.IsAggregateType(event.AggregateType) ||
		!federationspec.IsAggregateID(event.AggregateID) ||
		event.AggregateVersion < 1 {
		return pgtype.UUID{}, fmt.Errorf("invalid federation event %q", event.Kind)
	}
	payload, err := json.Marshal(event.Payload)
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("encode federation event payload: %w", err)
	}
	if !federationspec.IsJSONObject(payload) {
		return pgtype.UUID{}, fmt.Errorf("federation event payload is not an object")
	}
	eventID, err := dbvalue.NewUUID()
	if err != nil {
		return pgtype.UUID{}, err
	}
	if err := q.CreateFederationOutboxEvent(ctx,
		sqlc.CreateFederationOutboxEventParams{
			EventID: eventID, Kind: string(event.Kind),
			DestinationPrincipalType: string(event.Destination.Type),
			DestinationPrincipalDid:  event.Destination.DID,
			AggregateType:            string(event.AggregateType),
			AggregateID:              event.AggregateID,
			AggregateVersion:         event.AggregateVersion,
			PayloadBytes:             payload,
		}); err != nil {
		return pgtype.UUID{}, fmt.Errorf("enqueue federation event: %w", err)
	}
	return eventID, nil
}

var (
	// ErrEventConflict reports an event id already received for another
	// event: a protocol error that redelivery cannot fix.
	ErrEventConflict = errors.New("federation event id reused for another event")
	// ErrMisdirected reports a destination principal this tenant does not
	// home; nothing was recorded.
	ErrMisdirected = errors.New("federation event destination not homed here")
	// ErrUnsupportedKind reports a kind this tenant has no handler for;
	// nothing was recorded.
	ErrUnsupportedKind = errors.New("federation event kind not supported")
	// ErrOriginMismatch reports an event whose origin principal the sending
	// tenant does not home: a refusal that redelivery cannot change; nothing
	// was recorded.
	ErrOriginMismatch = errors.New("federation event origin not homed at its source")
)

// digest identifies an event's content at the receiver. The payload is
// re-encoded canonically so relaying it never changes the digest.
func digest(event Event) ([]byte, error) {
	canonical, err := meshwire.Canonical(event.Payload)
	if err != nil {
		return nil, err
	}
	sum := sha256.New()
	for _, part := range []string{
		string(event.Kind), string(event.Destination.Type),
		dbvalue.FormatUUID(event.Destination.DID),
		string(event.AggregateType), event.AggregateID,
	} {
		sum.Write([]byte(part + "\x00"))
	}
	_ = binary.Write(sum, binary.BigEndian, event.AggregateVersion)
	sum.Write(canonical)
	return sum.Sum(nil), nil
}

// wireRequest is the mesh representation of event.
func wireRequest(event Event) federationspec.DeliverEventRequest {
	return federationspec.DeliverEventRequest{
		EventID:                  federationspec.EventID(dbvalue.FormatUUID(event.EventID)),
		Kind:                     event.Kind,
		DestinationPrincipalType: event.Destination.Type,
		DestinationPrincipalDID: directoryspec.PrincipalDID(
			dbvalue.FormatUUID(event.Destination.DID),
		),
		AggregateType:    event.AggregateType,
		AggregateID:      event.AggregateID,
		AggregateVersion: event.AggregateVersion,
		Payload:          event.Payload,
	}
}

// FromWire converts a validated mesh request into the event a Receiver
// applies for sourceTenantID.
func FromWire(
	request federationspec.DeliverEventRequest, sourceTenantID string,
) (Event, error) {
	eventID, err := dbvalue.ParseUUID(string(request.EventID))
	if err != nil {
		return Event{}, err
	}
	did, err := dbvalue.ParseUUID(string(request.DestinationPrincipalDID))
	if err != nil {
		return Event{}, err
	}
	return Event{
		EventID: eventID, SourceTenantID: sourceTenantID, Kind: request.Kind,
		Destination: Principal{
			Type: request.DestinationPrincipalType, DID: did,
		},
		AggregateType: request.AggregateType, AggregateID: request.AggregateID,
		AggregateVersion: request.AggregateVersion, Payload: request.Payload,
	}, nil
}
