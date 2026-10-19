// Package hubapplicationclient reads a Hub user's application live from the
// Org's home tenant: through the local relay from hub-api, or at the peer
// listener from mesh-api.
package hubapplicationclient

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/federation/meshwire"
)

var ErrInvalidResponse = errors.New("invalid Hub application response")

// Outcome is the read application or the problem the other side answered.
type Outcome struct {
	Result  *hubspec.MyApplication
	Problem *problem.Details
}

type Client struct {
	relayEndpoint string
	credential    string
	baseTLS       *tls.Config
	timeout       time.Duration
}

func NewRelay(baseURL, credential string, timeout time.Duration) *Client {
	return &Client{
		relayEndpoint: meshwire.RelayURL(baseURL, "/mesh/hub-applications/get"),
		credential:    credential, timeout: timeout,
	}
}

func NewPeer(baseTLS *tls.Config, timeout time.Duration) *Client {
	return &Client{baseTLS: baseTLS, timeout: timeout}
}

func (c *Client) RelayGet(
	ctx context.Context, request hubspec.MeshGetApplicationRequest,
) (Outcome, error) {
	return c.get(ctx, c.relayEndpoint, c.credential, nil, request)
}

func (c *Client) PeerGet(
	ctx context.Context, tenant directoryspec.TenantID,
	request hubspec.MeshGetApplicationRequest,
) (Outcome, error) {
	tlsConfig := meshwire.PeerTLS(c.baseTLS, tenant)
	if tlsConfig == nil {
		return Outcome{}, fmt.Errorf("%w: invalid peer configuration", ErrInvalidResponse)
	}
	return c.get(ctx,
		meshwire.PeerURL(tenant, "/api/mesh/hub-applications/get"), "",
		tlsConfig, request)
}

func (c *Client) get(
	ctx context.Context, endpoint, credential string, tlsConfig *tls.Config,
	request hubspec.MeshGetApplicationRequest,
) (Outcome, error) {
	exchange, err := meshwire.Post(
		ctx, endpoint, credential, tlsConfig, c.timeout, request,
	)
	if err != nil {
		return Outcome{}, err
	}
	var result hubspec.MyApplication
	if exchange.JSON(&result) {
		if !result.Valid() || result.OrgDomain != request.Domain ||
			result.OpeningNumber != request.OpeningNumber ||
			result.ApplicationNumber != request.ApplicationNumber {
			return Outcome{}, ErrInvalidResponse
		}
		return Outcome{Result: &result}, nil
	}
	details, ok := exchange.Problem()
	if !ok {
		return Outcome{}, fmt.Errorf("%w: status %d", ErrInvalidResponse,
			exchange.Status)
	}
	return Outcome{Problem: &details}, nil
}
