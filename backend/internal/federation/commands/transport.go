package commands

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
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/federation/meshwire"
)

// Relay sends a command to the tenant-local mesh relay.
type Relay interface {
	Execute(context.Context, federationspec.ExecuteCommandRequest) (Response, error)
}

// RelayClient is the API servers' and workers' Relay: it posts to
// mesh-api's tenant-local listener with the relay bearer credential.
type RelayClient struct {
	endpoint   string
	credential string
	timeout    time.Duration
}

func NewRelay(baseURL, credential string, timeout time.Duration) *RelayClient {
	return &RelayClient{
		endpoint:   meshwire.RelayURL(baseURL, "/mesh/commands/execute"),
		credential: credential, timeout: timeout,
	}
}

// Execute returns the authority's stored outcome, or the relay's
// authority-not-found problem as a deterministic 404 outcome. ErrNotSent
// means the command certainly did not run; any other failure is
// ErrOutcomeUnknown.
func (c *RelayClient) Execute(
	ctx context.Context, request federationspec.ExecuteCommandRequest,
) (Response, error) {
	exchange, err := meshwire.Post(
		ctx, c.endpoint, c.credential, nil, c.timeout, request,
	)
	if err != nil {
		return Response{}, err
	}
	if response, ok := result(exchange); ok {
		return response, nil
	}
	details, ok := exchange.Problem()
	switch {
	case ok && details.Type == federationproblem.AuthorityNotFoundError.Type:
		return Response{Status: details.Status, Body: exchange.Body}, nil
	case ok && (details.Type ==
		federationproblem.AuthorityUnavailableError.Type ||
		details.Type ==
			coordinatorproblem.MeshRelayAuthenticationRequiredError.Type):
		return Response{}, fmt.Errorf("%w: relay %s", ErrNotSent, details.Type)
	case ok:
		return Response{}, fmt.Errorf("%w: relay %s", ErrOutcomeUnknown, details.Type)
	default:
		return Response{}, fmt.Errorf(
			"%w: relay status %d", ErrOutcomeUnknown, exchange.Status,
		)
	}
}

// PeerOutcome is a peer's answer: a stored outcome, or a problem saying the
// command did not run there (conflict, misdirected, or invalid).
type PeerOutcome struct {
	Result  *Response
	Problem *problem.Details
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
			return meshwire.PeerURL(tenant, "/api/mesh/commands/execute")
		},
	}
}

func (c *PeerClient) Execute(
	ctx context.Context, tenant directoryspec.TenantID,
	request federationspec.ExecuteCommandRequest,
) (PeerOutcome, error) {
	tlsConfig := meshwire.PeerTLS(c.baseTLS, tenant)
	if tlsConfig == nil {
		return PeerOutcome{}, fmt.Errorf("%w: invalid peer configuration", ErrNotSent)
	}
	exchange, err := meshwire.Post(
		ctx, c.endpoint(tenant), "", tlsConfig, c.timeout, request,
	)
	if err != nil {
		return PeerOutcome{}, err
	}
	if response, ok := result(exchange); ok {
		return PeerOutcome{Result: &response}, nil
	}
	details, ok := exchange.Problem()
	if ok && exchange.Status < http.StatusInternalServerError {
		return PeerOutcome{Problem: &details}, nil
	}
	return PeerOutcome{}, fmt.Errorf(
		"%w: peer status %d", ErrOutcomeUnknown, exchange.Status,
	)
}

func result(exchange meshwire.Exchange) (Response, bool) {
	var result federationspec.CommandResult
	if !exchange.JSON(&result) || !federationspec.IsCommandResult(result) {
		return Response{}, false
	}
	return Response{Status: int(result.Status), Body: result.Body}, true
}
