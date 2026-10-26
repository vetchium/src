package events

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"

	"backend/internal/federation/meshwire"
)

// Delivery is a definite answer: a receipt, or a problem that redelivery
// cannot change.
type Delivery struct {
	Receipt *federationspec.EventReceipt
	Problem *problem.Details
}

// Relay sends an event to the tenant-local mesh relay. An error means
// delivery is unconfirmed and the event must be delivered again.
type Relay interface {
	Deliver(context.Context, federationspec.DeliverEventRequest) (Delivery, error)
}

// RelayClient is the workers' Relay: it posts to mesh-api's tenant-local
// listener with the relay bearer credential.
type RelayClient struct {
	endpoint   string
	credential string
	timeout    time.Duration
}

func NewRelay(baseURL, credential string, timeout time.Duration) *RelayClient {
	return &RelayClient{
		endpoint:   meshwire.RelayURL(baseURL, "/mesh/events/deliver"),
		credential: credential, timeout: timeout,
	}
}

// Deliver returns a receipt, or the event-conflict, origin-mismatch, or
// destination-not-found problem; anything else is an error.
func (c *RelayClient) Deliver(
	ctx context.Context, request federationspec.DeliverEventRequest,
) (Delivery, error) {
	exchange, err := meshwire.Post(
		ctx, c.endpoint, c.credential, nil, c.timeout, request,
	)
	if err != nil {
		return Delivery{}, err
	}
	if receipt, ok := eventReceipt(exchange); ok {
		return Delivery{Receipt: &receipt}, nil
	}
	details, ok := exchange.Problem()
	switch {
	case ok && (details.Type == federationproblem.EventConflictError.Type ||
		details.Type == federationproblem.EventOriginMismatchError.Type ||
		details.Type == federationproblem.DestinationNotFoundError.Type):
		return Delivery{Problem: &details}, nil
	case ok:
		return Delivery{}, fmt.Errorf("federation event relay %s", details.Type)
	default:
		return Delivery{}, fmt.Errorf(
			"federation event relay status %d", exchange.Status,
		)
	}
}

// PeerClient is mesh-api's client for other tenants' peer listeners, which
// it reaches with this tenant's mesh client certificate.
type PeerClient struct {
	baseTLS  *tls.Config
	timeout  time.Duration
	endpoint func(directoryspec.TenantID) string
}

func NewPeer(baseTLS *tls.Config, timeout time.Duration) *PeerClient {
	return &PeerClient{
		baseTLS: baseTLS, timeout: timeout,
		endpoint: func(tenant directoryspec.TenantID) string {
			return meshwire.PeerURL(tenant, "/api/mesh/events/deliver")
		},
	}
}

// Deliver returns the peer's receipt or a client-error problem saying it
// recorded nothing; anything else is an error.
func (c *PeerClient) Deliver(
	ctx context.Context, tenant directoryspec.TenantID,
	request federationspec.DeliverEventRequest,
) (Delivery, error) {
	tlsConfig := meshwire.PeerTLS(c.baseTLS, tenant)
	if tlsConfig == nil {
		return Delivery{}, fmt.Errorf("%w: invalid peer configuration",
			meshwire.ErrNotSent)
	}
	exchange, err := meshwire.Post(
		ctx, c.endpoint(tenant), "", tlsConfig, c.timeout, request,
	)
	if err != nil {
		return Delivery{}, err
	}
	if receipt, ok := eventReceipt(exchange); ok {
		return Delivery{Receipt: &receipt}, nil
	}
	details, ok := exchange.Problem()
	if ok && exchange.Status < http.StatusInternalServerError {
		return Delivery{Problem: &details}, nil
	}
	return Delivery{}, fmt.Errorf(
		"%w: peer status %d", meshwire.ErrOutcomeUnknown, exchange.Status,
	)
}

func eventReceipt(
	exchange meshwire.Exchange,
) (federationspec.EventReceipt, bool) {
	var receipt federationspec.EventReceipt
	if !exchange.JSON(&receipt) ||
		!federationspec.IsEventDeliveryOutcome(receipt.Outcome) {
		return federationspec.EventReceipt{}, false
	}
	return receipt, true
}
