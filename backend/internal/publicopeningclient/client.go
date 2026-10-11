// Package publicopeningclient reads an Org's public Openings through the local
// relay or its mutually authenticated home-tenant peer.
package publicopeningclient

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
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/problem"
)

const maxResponseBytes = 1 << 20

var ErrInvalidResponse = errors.New("invalid public Opening response")

type ListOutcome struct {
	Result  *openingsspec.ListOrgOpeningsResponse
	Problem *problem.Details
}

type GetOutcome struct {
	Result  *openingsspec.GetOrgOpeningResponse
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
		credential: credential, timeout: timeout,
	}
}

func NewPeer(baseTLS *tls.Config, timeout time.Duration) *Client {
	return &Client{baseTLS: baseTLS, timeout: timeout}
}

func (c *Client) RelayList(
	ctx context.Context, request openingsspec.ListOrgOpeningsRequest,
) (ListOutcome, error) {
	var result openingsspec.ListOrgOpeningsResponse
	problem, err := c.read(ctx, c.baseURL+"/mesh/org-openings/list",
		request, nil, &result)
	if err != nil || problem != nil {
		return ListOutcome{Problem: problem}, err
	}
	if err := validateList(result, string(request.Domain)); err != nil {
		return ListOutcome{}, err
	}
	return ListOutcome{Result: &result}, nil
}

func (c *Client) RelayGet(
	ctx context.Context, request openingsspec.GetOrgOpeningRequest,
) (GetOutcome, error) {
	var result openingsspec.GetOrgOpeningResponse
	problem, err := c.read(ctx, c.baseURL+"/mesh/org-openings/get",
		request, nil, &result)
	if err != nil || problem != nil {
		return GetOutcome{Problem: problem}, err
	}
	if err := validateGet(result, request); err != nil {
		return GetOutcome{}, err
	}
	return GetOutcome{Result: &result}, nil
}

func (c *Client) PeerList(
	ctx context.Context, tenant directoryspec.TenantID,
	request openingsspec.ListOrgOpeningsRequest,
) (ListOutcome, error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, "list")
	if err != nil {
		return ListOutcome{}, err
	}
	var result openingsspec.ListOrgOpeningsResponse
	problem, err := c.read(ctx, endpoint, request, tlsConfig, &result)
	if err != nil || problem != nil {
		return ListOutcome{Problem: problem}, err
	}
	if err := validateList(result, string(request.Domain)); err != nil {
		return ListOutcome{}, err
	}
	return ListOutcome{Result: &result}, nil
}

func (c *Client) PeerGet(
	ctx context.Context, tenant directoryspec.TenantID,
	request openingsspec.GetOrgOpeningRequest,
) (GetOutcome, error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, "get")
	if err != nil {
		return GetOutcome{}, err
	}
	var result openingsspec.GetOrgOpeningResponse
	problem, err := c.read(ctx, endpoint, request, tlsConfig, &result)
	if err != nil || problem != nil {
		return GetOutcome{Problem: problem}, err
	}
	if err := validateGet(result, request); err != nil {
		return GetOutcome{}, err
	}
	return GetOutcome{Result: &result}, nil
}

func (c *Client) peerEndpoint(
	tenant directoryspec.TenantID, action string,
) (string, *tls.Config, error) {
	if !directoryspec.IsTenantID(tenant) || c.baseTLS == nil {
		return "", nil, fmt.Errorf("%w: invalid peer configuration", ErrInvalidResponse)
	}
	name := string(tenant) + ".mesh.vetchium.com"
	tlsConfig := c.baseTLS.Clone()
	tlsConfig.ServerName = name
	return "https://" + name + ":8443/api/mesh/org-openings/" + action,
		tlsConfig, nil
}

func (c *Client) read(
	ctx context.Context, endpoint string, payload any,
	tlsConfig *tls.Config, result any,
) (*problem.Details, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint, bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if c.credential != "" {
		request.Header.Set("Authorization", "Bearer "+c.credential)
	}
	transport := &http.Transport{TLSClientConfig: tlsConfig}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Timeout: c.timeout, Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("read public Org Openings: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxResponseBytes {
		return nil, fmt.Errorf("%w: body too large", ErrInvalidResponse)
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.StatusCode == http.StatusOK && mediaType == "application/json" {
		return nil, decode(data, result)
	}
	if mediaType != problem.MediaType {
		return nil, fmt.Errorf("%w: response type", ErrInvalidResponse)
	}
	var details problem.Details
	if err := decode(data, &details); err != nil {
		return nil, err
	}
	if details.Status != response.StatusCode || details.Type == "" {
		return nil, fmt.Errorf("%w: inconsistent problem", ErrInvalidResponse)
	}
	return &details, nil
}

func decode(data []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidResponse, err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("%w: trailing data", ErrInvalidResponse)
	}
	return nil
}

func validateList(
	result openingsspec.ListOrgOpeningsResponse, domain string,
) error {
	if string(result.Org.Domain) != domain || result.Openings == nil {
		return ErrInvalidResponse
	}
	for _, opening := range result.Openings {
		if opening.OpeningNumber < 1 || opening.Title == "" ||
			opening.FirstPublishedAt.IsZero() {
			return ErrInvalidResponse
		}
	}
	return nil
}

func validateGet(
	result openingsspec.GetOrgOpeningResponse,
	request openingsspec.GetOrgOpeningRequest,
) error {
	if result.Org.Domain != request.Domain ||
		result.Opening.OpeningNumber != request.OpeningNumber {
		return ErrInvalidResponse
	}
	opening := result.Opening
	switch opening.State {
	case openingsspec.Published:
		if opening.Content == nil || opening.FirstPublishedAt == nil ||
			opening.Title != nil {
			return ErrInvalidResponse
		}
	case openingsspec.NotAccepting:
		if opening.Title == nil || opening.Content != nil ||
			opening.FirstPublishedAt != nil || opening.LastRevisedAt != nil {
			return ErrInvalidResponse
		}
	default:
		return ErrInvalidResponse
	}
	return nil
}
