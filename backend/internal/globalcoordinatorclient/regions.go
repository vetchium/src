package globalcoordinatorclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"

	"github.com/vetchium/src/typespec/common"
	regionspec "github.com/vetchium/src/typespec/regions"

	"backend/internal/regions"
)

func (c *Client) ListSignupRegions(
	ctx context.Context, body regionspec.ListSignupRegionsRequest,
) (regionspec.ListSignupRegionsResponse, error) {
	var result regionspec.ListSignupRegionsResponse
	data, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	path := c.RegionsPath
	if path == "" {
		path = "/api/global-coordinator/list-signup-regions"
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(data),
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
