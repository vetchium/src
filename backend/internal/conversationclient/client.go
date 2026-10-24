package conversationclient

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
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"
)

const maxResponseBytes = 4 << 20

var ErrInvalidResponse = errors.New("invalid conversation response")

type Outcome[T any] struct {
	Result  *T
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

func (c *Client) RelayRead(
	ctx context.Context, request federationspec.MeshReadConversationRequest,
) (Outcome[federationspec.MeshReadConversationResponse], error) {
	var result federationspec.MeshReadConversationResponse
	prob, err := c.read(ctx, c.baseURL+"/mesh/conversations/read", request, nil, &result)
	if err != nil || prob != nil {
		return Outcome[federationspec.MeshReadConversationResponse]{Problem: prob}, err
	}
	return Outcome[federationspec.MeshReadConversationResponse]{Result: &result}, nil
}

func (c *Client) PeerRead(
	ctx context.Context, tenant directoryspec.TenantID,
	request federationspec.MeshReadConversationRequest,
) (Outcome[federationspec.MeshReadConversationResponse], error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, "read")
	if err != nil {
		return Outcome[federationspec.MeshReadConversationResponse]{}, err
	}
	var result federationspec.MeshReadConversationResponse
	prob, err := c.read(ctx, endpoint, request, tlsConfig, &result)
	if err != nil || prob != nil {
		return Outcome[federationspec.MeshReadConversationResponse]{Problem: prob}, err
	}
	return Outcome[federationspec.MeshReadConversationResponse]{Result: &result}, nil
}

func (c *Client) peerEndpoint(
	tenant directoryspec.TenantID, operation string,
) (string, *tls.Config, error) {
	if !directoryspec.IsTenantID(tenant) || c.baseTLS == nil {
		return "", nil, fmt.Errorf("%w: invalid peer configuration", ErrInvalidResponse)
	}
	name := string(tenant) + ".mesh.vetchium.com"
	tlsConfig := c.baseTLS.Clone()
	tlsConfig.ServerName = name
	return "https://" + name + ":8443/api/mesh/conversations/" + operation, tlsConfig, nil
}

func (c *Client) read(
	ctx context.Context, endpoint string, request any,
	tlsConfig *tls.Config, response any,
) (*problem.Details, error) {
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("encode conversation request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, fmt.Errorf("create conversation request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, application/problem+json")
	if c.credential != "" {
		req.Header.Set("Authorization", "Bearer "+c.credential)
	}

	transport := http.DefaultTransport
	if tlsConfig != nil {
		transport = &http.Transport{
			TLSClientConfig:     tlsConfig,
			ForceAttemptHTTP2:   true,
			DisableKeepAlives:   true,
			MaxIdleConns:        0,
			IdleConnTimeout:     c.timeout,
			TLSHandshakeTimeout: c.timeout,
		}
	}
	client := &http.Client{Transport: transport, Timeout: c.timeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("read conversation response: %w", err)
	}

	contentType := resp.Header.Get("Content-Type")
	mediaType, _, _ := mime.ParseMediaType(contentType)
	if resp.StatusCode >= 400 {
		if mediaType == "application/problem+json" || mediaType == "application/json" {
			var details problem.Details
			if json.Unmarshal(body, &details) == nil && details.Type != "" {
				return &details, nil
			}
		}
		return nil, fmt.Errorf("%w: status %d", ErrInvalidResponse, resp.StatusCode)
	}
	if mediaType != "application/json" {
		return nil, fmt.Errorf("%w: content-type %s", ErrInvalidResponse, contentType)
	}
	if err := json.Unmarshal(body, response); err != nil {
		return nil, fmt.Errorf("%w: decode body: %v", ErrInvalidResponse, err)
	}
	return nil, nil
}
