// Package regionsclient calls a signup-region directory over HTTP. One client
// type serves both hops of discovery: hub-api calls its own tenant's mesh API,
// and mesh-api calls the global coordinator. Each hop carries its own
// credential, so neither can be replayed against the other.
package regionsclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	regionspec "github.com/vetchium/src/typespec/regions"

	"backend/internal/regions"
)

// MeshPath and CoordinatorPath are the two directory endpoints a client can be
// pointed at.
const (
	MeshPath        = "/mesh/list-signup-regions"
	CoordinatorPath = "/api/global-coordinator/list-signup-regions"
)

type Client struct {
	endpoint   string
	credential string
	httpClient *http.Client
}

// New builds a client for one directory endpoint. Redirects are refused rather
// than followed, so a relocated endpoint cannot silently receive the
// credential.
func New(baseURL, path, credential string, timeout time.Duration) *Client {
	return &Client{
		endpoint:   strings.TrimRight(baseURL, "/") + path,
		credential: credential,
		httpClient: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (c *Client) ListSignupRegions(
	ctx context.Context, body regionspec.ListSignupRegionsRequest,
) (regionspec.ListSignupRegionsResponse, error) {
	var result regionspec.ListSignupRegionsResponse
	data, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.endpoint, bytes.NewReader(data),
	)
	if err != nil {
		return result, err
	}
	request.Header.Set("Authorization", "Bearer "+c.credential)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return result, fmt.Errorf("discover signup regions: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	// 400 is the only status that blames the request itself. An auth failure or
	// a 5xx is a fault on this side of the call, where falling back to the
	// bundled catalog is the right answer.
	if response.StatusCode == http.StatusBadRequest {
		return result, fmt.Errorf(
			"%w: %d", regions.ErrRequestRejected, response.StatusCode,
		)
	}
	if response.StatusCode != http.StatusOK || mediaType != "application/json" {
		return result, fmt.Errorf("invalid discovery response: %d", response.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return result, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return result, fmt.Errorf("trailing discovery data")
	}
	if result.CatalogVersion == "" || result.Regions == nil || len(result.Regions) > 50 {
		return result, fmt.Errorf("invalid discovery page")
	}
	if result.NextPaginationKey != nil && !common.IsPaginationKey(*result.NextPaginationKey) {
		return result, fmt.Errorf("invalid discovery cursor")
	}
	last := ""
	for _, region := range result.Regions {
		if !regions.IsHubOrigin(region.HubURL) ||
			!regions.IsTenantID(region.TenantID) ||
			region.TenantID <= last ||
			!common.IsCountryCode(region.HostingCountry) {
			return result, fmt.Errorf("invalid discovery region")
		}
		last = region.TenantID
	}
	return result, nil
}
