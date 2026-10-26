// Package listingclient reads marketplace Listings through the local relay or
// a tenant's mutually authenticated peer listener.
package listingclient

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
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"
)

const maxResponseBytes = 4 << 20

var ErrInvalidResponse = errors.New("invalid Listing response")

type SearchOutcome struct {
	Result  *marketplace.PeerSearchListingsResponse
	Problem *problem.Details
}

type GetOutcome struct {
	Result  *marketplace.ListingDetail
	Problem *problem.Details
}

type EngagementListingOutcome struct {
	Result  *marketplace.EngagementListing
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

// RelaySearch asks the local relay to search request.Tenant.
func (c *Client) RelaySearch(
	ctx context.Context, request marketplace.RelaySearchListingsRequest,
) (SearchOutcome, error) {
	return c.search(ctx, c.baseURL+"/mesh/listings/search", request,
		nil, request.Search)
}

// RelayGet asks the local relay to read a Listing at request.Tenant.
func (c *Client) RelayGet(
	ctx context.Context, request marketplace.RelayGetListingRequest,
) (GetOutcome, error) {
	return c.get(ctx, c.baseURL+"/mesh/listings/get", request,
		nil, request.Listing)
}

func (c *Client) PeerSearch(
	ctx context.Context, tenant directoryspec.TenantID,
	request marketplace.PeerSearchListingsRequest,
) (SearchOutcome, error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, "search")
	if err != nil {
		return SearchOutcome{}, err
	}
	return c.search(ctx, endpoint, request, tlsConfig, request)
}

func (c *Client) PeerGet(
	ctx context.Context, tenant directoryspec.TenantID,
	request marketplace.GetListingRequest,
) (GetOutcome, error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, "get")
	if err != nil {
		return GetOutcome{}, err
	}
	return c.get(ctx, endpoint, request, tlsConfig, request)
}

// RelayEngagementListing asks the local relay for the Listing behind an
// engagement at request.Tenant.
func (c *Client) RelayEngagementListing(
	ctx context.Context, request marketplace.RelayEngagementListingRequest,
) (EngagementListingOutcome, error) {
	return c.engagementListing(ctx, c.baseURL+"/mesh/listings/engagement-listing",
		request, nil)
}

func (c *Client) PeerEngagementListing(
	ctx context.Context, tenant directoryspec.TenantID,
	request marketplace.PeerEngagementListingRequest,
) (EngagementListingOutcome, error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, "engagement-listing")
	if err != nil {
		return EngagementListingOutcome{}, err
	}
	return c.engagementListing(ctx, endpoint, request, tlsConfig)
}

func (c *Client) engagementListing(
	ctx context.Context, endpoint string, payload any, tlsConfig *tls.Config,
) (EngagementListingOutcome, error) {
	var result marketplace.EngagementListing
	problem, err := c.read(ctx, endpoint, payload, tlsConfig, &result)
	if err != nil || problem != nil {
		return EngagementListingOutcome{Problem: problem}, err
	}
	if !marketplace.IsCapability(result.Capability) ||
		(result.Capability == marketplace.BackgroundCheck) !=
			(result.ConsentDisclosure != nil && len(result.CheckTypes) > 0) {
		return EngagementListingOutcome{}, ErrInvalidResponse
	}
	return EngagementListingOutcome{Result: &result}, nil
}

func (c *Client) search(
	ctx context.Context, endpoint string, payload any, tlsConfig *tls.Config,
	asked marketplace.PeerSearchListingsRequest,
) (SearchOutcome, error) {
	var result marketplace.PeerSearchListingsResponse
	problem, err := c.read(ctx, endpoint, payload, tlsConfig, &result)
	if err != nil || problem != nil {
		return SearchOutcome{Problem: problem}, err
	}
	if err := validateSearch(result, asked); err != nil {
		return SearchOutcome{}, err
	}
	return SearchOutcome{Result: &result}, nil
}

func (c *Client) get(
	ctx context.Context, endpoint string, payload any, tlsConfig *tls.Config,
	asked marketplace.GetListingRequest,
) (GetOutcome, error) {
	var result marketplace.ListingDetail
	problem, err := c.read(ctx, endpoint, payload, tlsConfig, &result)
	if err != nil || problem != nil {
		return GetOutcome{Problem: problem}, err
	}
	if err := validateGet(result, asked); err != nil {
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
	return "https://" + name + ":8443/api/mesh/listings/" + action,
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
		return nil, fmt.Errorf("read Listings: %w", err)
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

// validateSearch holds a tenant to its contract: the merge in orgs-api trusts
// the order, the page size, and the Capability.
func validateSearch(
	result marketplace.PeerSearchListingsResponse,
	asked marketplace.PeerSearchListingsRequest,
) error {
	if result.Listings == nil || len(result.Listings) > int(asked.Limit) {
		return ErrInvalidResponse
	}
	var previous *marketplace.ListingSearchPosition
	if asked.After != nil {
		after := *asked.After
		previous = &after
	}
	for _, entry := range result.Listings {
		listing := entry.Listing
		if entry.SortName == "" || listing.Headline == "" ||
			listing.Capability != asked.Capability ||
			!orgs.IsOrgDomain(listing.Provider.Domain) ||
			listing.Provider.DisplayName == "" ||
			listing.Languages == nil || listing.Service.Countries == nil {
			return ErrInvalidResponse
		}
		position := marketplace.ListingSearchPosition{
			SortName: entry.SortName, Domain: listing.Provider.Domain,
		}
		if previous != nil && !after(position, *previous) {
			return ErrInvalidResponse
		}
		previous = &position
	}
	return nil
}

func after(a, b marketplace.ListingSearchPosition) bool {
	if a.SortName != b.SortName {
		return a.SortName > b.SortName
	}
	return a.Domain > b.Domain
}

func validateGet(
	result marketplace.ListingDetail, asked marketplace.GetListingRequest,
) error {
	if result.Provider.Domain != asked.Domain ||
		result.Capability != asked.Capability ||
		result.Headline == "" || result.Description == "" ||
		result.Languages == nil || result.Service.Countries == nil {
		return ErrInvalidResponse
	}
	return nil
}
