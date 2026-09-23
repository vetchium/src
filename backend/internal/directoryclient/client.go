// Package directoryclient calls the global Hub identity directory through
// either a tenant-local bearer-authenticated relay or coordinator mTLS.
package directoryclient

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
	"github.com/vetchium/src/typespec/problem"
)

const (
	MeshPrefix        = "/mesh/directory"
	CoordinatorPrefix = "/api/global-coordinator/directory"
	maxResponseBytes  = 1 << 20
)

var ErrInvalidResponse = errors.New("invalid directory response")

type Outcome struct {
	Status    int
	Principal *directoryspec.PrincipalCommandResponse
	Problem   *problem.Details
}

type Client struct {
	baseURL    string
	prefix     string
	credential string
	httpClient *http.Client
}

func New(baseURL, prefix, credential string, timeout time.Duration) *Client {
	return newClient(baseURL, prefix, credential, timeout, nil)
}

func NewMutualTLS(
	baseURL, prefix string, timeout time.Duration, tlsConfig *tls.Config,
) *Client {
	return newClient(baseURL, prefix, "", timeout, tlsConfig)
}

func newClient(
	baseURL, prefix, credential string, timeout time.Duration,
	tlsConfig *tls.Config,
) *Client {
	transport := http.DefaultTransport
	if tlsConfig != nil {
		transport = &http.Transport{TLSClientConfig: tlsConfig}
	}
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"), prefix: prefix,
		credential: credential,
		httpClient: &http.Client{
			Timeout: timeout, Transport: transport,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (c *Client) ResolveProfileSlug(
	ctx context.Context, request directoryspec.ResolveProfileSlugRequest,
) (directoryspec.ResolveProfileSlugResponse, *problem.Details, error) {
	var result directoryspec.ResolveProfileSlugResponse
	status, body, mediaType, err := c.do(ctx, "resolve-profile-slug", request)
	if err != nil {
		return result, nil, err
	}
	if status == http.StatusOK && mediaType == "application/json" {
		if err := decode(body, &result); err != nil {
			return result, nil, err
		}
		if !hubspec.IsHubUserDID(result.HubUserDID) ||
			!directoryspec.IsProfileSlug(result.Slug) ||
			!directoryspec.IsTenantID(result.HomeTenantID) ||
			result.RoutingVersion < 1 ||
			(result.Kind != directoryspec.ProfileSlugKindHandle &&
				result.Kind != directoryspec.ProfileSlugKindAlias) {
			return result, nil, fmt.Errorf("%w: invalid lookup result", ErrInvalidResponse)
		}
		return result, nil, nil
	}
	details, err := decodeProblem(status, mediaType, body)
	return result, details, err
}

func (c *Client) ReserveHubPrincipal(
	ctx context.Context, request directoryspec.ReserveHubPrincipalRequest,
) (Outcome, error) {
	return c.command(ctx, "reserve-hub-principal", request)
}

func (c *Client) ActivateHubPrincipal(
	ctx context.Context, request directoryspec.ActivateHubPrincipalRequest,
) (Outcome, error) {
	return c.command(ctx, "activate-hub-principal", request)
}

func (c *Client) SetHubAlias(
	ctx context.Context, request directoryspec.SetHubAliasRequest,
) (Outcome, error) {
	return c.command(ctx, "set-hub-alias", request)
}

func (c *Client) command(ctx context.Context, operation string, request any) (Outcome, error) {
	status, body, mediaType, err := c.do(ctx, operation, request)
	if err != nil {
		return Outcome{}, err
	}
	if status == http.StatusOK && mediaType == "application/json" {
		var principal directoryspec.PrincipalCommandResponse
		if err := decode(body, &principal); err != nil {
			return Outcome{}, err
		}
		if !validPrincipal(principal) {
			return Outcome{}, fmt.Errorf("%w: invalid principal", ErrInvalidResponse)
		}
		return Outcome{Status: status, Principal: &principal}, nil
	}
	details, err := decodeProblem(status, mediaType, body)
	if err != nil {
		return Outcome{}, err
	}
	return Outcome{Status: status, Problem: details}, nil
}

func validPrincipal(principal directoryspec.PrincipalCommandResponse) bool {
	if !hubspec.IsHubUserDID(principal.HubUserDID) ||
		!hubspec.IsHubHandle(principal.Handle) ||
		!directoryspec.IsTenantID(principal.HomeTenantID) ||
		principal.RoutingVersion < 1 ||
		(principal.State != directoryspec.PrincipalProvisioning &&
			principal.State != directoryspec.PrincipalActive) {
		return false
	}
	if principal.ProfileAlias != nil &&
		!directoryspec.IsHubAlias(*principal.ProfileAlias) {
		return false
	}
	return true
}

func (c *Client) do(
	ctx context.Context, operation string, payload any,
) (int, []byte, string, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, "", err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost,
		c.baseURL+c.prefix+"/"+operation, bytes.NewReader(body),
	)
	if err != nil {
		return 0, nil, "", err
	}
	request.Header.Set("Content-Type", "application/json")
	if c.credential != "" {
		request.Header.Set("Authorization", "Bearer "+c.credential)
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return 0, nil, "", fmt.Errorf("directory %s: %w", operation, err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return 0, nil, "", err
	}
	if len(data) > maxResponseBytes {
		return 0, nil, "", fmt.Errorf("%w: body too large", ErrInvalidResponse)
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	return response.StatusCode, data, mediaType, nil
}

func decode(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidResponse, err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("%w: trailing data", ErrInvalidResponse)
	}
	return nil
}

func decodeProblem(status int, mediaType string, body []byte) (*problem.Details, error) {
	if mediaType != problem.MediaType {
		return nil, fmt.Errorf("%w: status %d content type %q", ErrInvalidResponse, status, mediaType)
	}
	var details problem.Details
	if err := decode(body, &details); err != nil {
		return nil, err
	}
	if details.Status != status || details.Type == "" || details.Title == "" {
		return nil, fmt.Errorf("%w: inconsistent problem", ErrInvalidResponse)
	}
	return &details, nil
}
