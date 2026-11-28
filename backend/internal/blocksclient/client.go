// Package blocksclient asks a blocker's home tenant whether the blocker
// blocked a viewer, through a tenant's local relay or a mutually
// authenticated tenant peer.
package blocksclient

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	blocksspec "github.com/vetchium/src/typespec/hub/blocks"
	"github.com/vetchium/src/typespec/problem"
)

const maxResponseBytes = 1 << 16

var ErrInvalidResponse = errors.New("invalid block check response")

// Outcome is a tenant's answer: Blocked, or the declared Problem.
type Outcome struct {
	Blocked bool
	Problem *problem.Details
}

type Client struct {
	baseURL    string
	credential string
	baseTLS    *tls.Config
	timeout    time.Duration
}

func NewRelay(baseURL, credential string, timeout time.Duration) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		credential: credential,
		timeout:    timeout,
	}
}

func NewPeer(baseTLS *tls.Config, timeout time.Duration) *Client {
	return &Client{baseTLS: baseTLS, timeout: timeout}
}

// Check asks the local mesh-api whether the blocker blocked the viewer. The
// viewer is the calling Hub user. A failure fails closed: the caller treats
// an error as an unavailable region.
func (c *Client) Check(
	ctx context.Context, blockerDID, blockedDID hubspec.HubUserDID,
	viewerHandle hubspec.HubHandle,
) (Outcome, error) {
	return c.check(ctx, c.baseURL+"/mesh/blocks/check", blocksspec.CheckBlockRequest{
		BlockerHubUserDID: blockerDID,
		BlockedHubUserDID: blockedDID,
		ViewerHandle:      viewerHandle,
	}, nil)
}

// PeerCheck asks the blocker's home tenant over the mesh.
func (c *Client) PeerCheck(
	ctx context.Context, tenant directoryspec.TenantID,
	request blocksspec.CheckBlockRequest,
) (Outcome, error) {
	if !directoryspec.IsTenantID(tenant) || c.baseTLS == nil {
		return Outcome{}, fmt.Errorf("%w: invalid peer configuration", ErrInvalidResponse)
	}
	name := string(tenant) + ".mesh.vetchium.com"
	tlsConfig := c.baseTLS.Clone()
	tlsConfig.ServerName = name
	return c.check(
		ctx, "https://"+name+":8443/api/mesh/blocks/check", request, tlsConfig,
	)
}

func (c *Client) check(
	ctx context.Context, endpoint string, payload any, tlsConfig *tls.Config,
) (Outcome, error) {
	status, mediaType, body, err := c.post(ctx, endpoint, payload, tlsConfig)
	if err != nil {
		return Outcome{}, err
	}
	if status == http.StatusOK && mediaType == "application/json" {
		var response blocksspec.CheckBlockResponse
		if err := decode(body, &response); err != nil {
			return Outcome{}, err
		}
		return Outcome{Blocked: response.Blocked}, nil
	}
	if mediaType != problem.MediaType {
		return Outcome{}, fmt.Errorf("%w: response type", ErrInvalidResponse)
	}
	var details problem.Details
	if err := decode(body, &details); err != nil {
		return Outcome{}, err
	}
	if details.Status != status || details.Type == "" {
		return Outcome{}, fmt.Errorf("%w: inconsistent problem", ErrInvalidResponse)
	}
	return Outcome{Problem: &details}, nil
}

func (c *Client) post(
	ctx context.Context, endpoint string, payload any, tlsConfig *tls.Config,
) (int, string, []byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, "", nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint, bytes.NewReader(body),
	)
	if err != nil {
		return 0, "", nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if c.credential != "" {
		request.Header.Set("Authorization", "Bearer "+c.credential)
	}
	transport := &http.Transport{TLSClientConfig: tlsConfig}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Timeout:   c.timeout,
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, "", nil, fmt.Errorf("check block: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return 0, "", nil, err
	}
	if len(data) > maxResponseBytes {
		return 0, "", nil, fmt.Errorf("%w: body too large", ErrInvalidResponse)
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	return response.StatusCode, mediaType, data, nil
}

func decode(body []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidResponse, err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("%w: trailing data", ErrInvalidResponse)
	}
	return nil
}
