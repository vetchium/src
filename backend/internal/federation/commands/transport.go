package commands

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync/atomic"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
)

const maxResponseBytes = 1 << 20

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
		endpoint:   strings.TrimRight(baseURL, "/") + "/mesh/commands/execute",
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
	exchange, err := post(ctx, c.endpoint, c.credential, nil, c.timeout, request)
	if err != nil {
		return Response{}, err
	}
	if response, ok := exchange.result(); ok {
		return response, nil
	}
	details, ok := exchange.problem()
	switch {
	case ok && details.Type == federationproblem.AuthorityNotFoundError.Type:
		return Response{Status: details.Status, Body: exchange.body}, nil
	case ok && (details.Type ==
		federationproblem.AuthorityUnavailableError.Type ||
		details.Type ==
			coordinatorproblem.MeshRelayAuthenticationRequiredError.Type):
		return Response{}, fmt.Errorf("%w: relay %s", ErrNotSent, details.Type)
	case ok:
		return Response{}, fmt.Errorf("%w: relay %s", ErrOutcomeUnknown, details.Type)
	default:
		return Response{}, fmt.Errorf(
			"%w: relay status %d", ErrOutcomeUnknown, exchange.status,
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
			return "https://" + peerServerName(tenant) +
				":8443/api/mesh/commands/execute"
		},
	}
}

func peerServerName(tenant directoryspec.TenantID) string {
	return string(tenant) + ".mesh.vetchium.com"
}

func (c *PeerClient) Execute(
	ctx context.Context, tenant directoryspec.TenantID,
	request federationspec.ExecuteCommandRequest,
) (PeerOutcome, error) {
	if !directoryspec.IsTenantID(tenant) || c.baseTLS == nil {
		return PeerOutcome{}, fmt.Errorf("%w: invalid peer configuration", ErrNotSent)
	}
	tlsConfig := c.baseTLS.Clone()
	tlsConfig.ServerName = peerServerName(tenant)
	exchange, err := post(
		ctx, c.endpoint(tenant), "", tlsConfig, c.timeout, request,
	)
	if err != nil {
		return PeerOutcome{}, err
	}
	if response, ok := exchange.result(); ok {
		return PeerOutcome{Result: &response}, nil
	}
	details, ok := exchange.problem()
	if ok && exchange.status < http.StatusInternalServerError {
		return PeerOutcome{Problem: &details}, nil
	}
	return PeerOutcome{}, fmt.Errorf(
		"%w: peer status %d", ErrOutcomeUnknown, exchange.status,
	)
}

type exchange struct {
	status    int
	mediaType string
	body      []byte
}

func (e exchange) result() (Response, bool) {
	if e.status != http.StatusOK || e.mediaType != "application/json" {
		return Response{}, false
	}
	var result federationspec.CommandResult
	if err := decodeStrict(e.body, &result); err != nil ||
		!federationspec.IsCommandResult(result) {
		return Response{}, false
	}
	return Response{Status: int(result.Status), Body: result.Body}, true
}

func (e exchange) problem() (problem.Details, bool) {
	var details problem.Details
	if e.mediaType != problem.MediaType ||
		json.Unmarshal(e.body, &details) != nil ||
		details.Status != e.status || details.Type == "" {
		return problem.Details{}, false
	}
	return details, true
}

// post classifies a failure by whether the whole request was written: an
// unwritten request cannot have run, a written one may have.
func post(
	ctx context.Context, endpoint, credential string, tlsConfig *tls.Config,
	timeout time.Duration, payload any,
) (exchange, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return exchange{}, fmt.Errorf("%w: encode: %v", ErrNotSent, err)
	}
	var written atomic.Bool
	ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			if info.Err == nil {
				written.Store(true)
			}
		},
	})
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint, bytes.NewReader(body),
	)
	if err != nil {
		return exchange{}, fmt.Errorf("%w: %v", ErrNotSent, err)
	}
	request.Header.Set("Content-Type", "application/json")
	if credential != "" {
		request.Header.Set("Authorization", "Bearer "+credential)
	}
	// A fresh transport per command never reuses a connection, so a written
	// request is never silently retried on another one.
	transport := &http.Transport{TLSClientConfig: tlsConfig}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Timeout: timeout, Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		if !written.Load() {
			return exchange{}, fmt.Errorf("%w: %v", ErrNotSent, err)
		}
		return exchange{}, fmt.Errorf("%w: %v", ErrOutcomeUnknown, err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		return exchange{}, fmt.Errorf("%w: unreadable response", ErrOutcomeUnknown)
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	return exchange{
		status: response.StatusCode, mediaType: mediaType, body: data,
	}, nil
}

func decodeStrict(data []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("trailing data")
	}
	return nil
}
