package publicopeningclient

import (
	"context"
	"crypto/tls"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/problem"
)

type SearchOutcome struct {
	Result  *openingsspec.SearchOpeningsResponse
	Problem *problem.Details
}

type SuggestOrgsOutcome struct {
	Result  *openingsspec.SuggestOpeningOrgsResponse
	Problem *problem.Details
}

// RelaySearch asks the local relay to search tenant. The request carries
// only the query, never the viewer (OPN-SRCH-002).
func (c *Client) RelaySearch(
	ctx context.Context, tenant directoryspec.TenantID,
	query openingsspec.OpeningSearchQuery,
) (SearchOutcome, error) {
	return c.search(ctx, c.baseURL+"/mesh/opening-search/search", nil,
		openingsspec.RelaySearchOpeningsRequest{TenantID: tenant, Query: query},
		query)
}

func (c *Client) RelaySuggestOrgs(
	ctx context.Context, tenant directoryspec.TenantID,
	query openingsspec.SuggestOpeningOrgsQuery,
) (SuggestOrgsOutcome, error) {
	return c.suggestOrgs(ctx, c.baseURL+"/mesh/opening-search/suggest-orgs", nil,
		openingsspec.RelaySuggestOpeningOrgsRequest{TenantID: tenant, Query: query})
}

func (c *Client) PeerSearch(
	ctx context.Context, tenant directoryspec.TenantID,
	query openingsspec.PeerSearchOpeningsRequest,
) (SearchOutcome, error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, "opening-search/search")
	if err != nil {
		return SearchOutcome{}, err
	}
	return c.search(ctx, endpoint, tlsConfig, query, query)
}

func (c *Client) PeerSuggestOrgs(
	ctx context.Context, tenant directoryspec.TenantID,
	query openingsspec.PeerSuggestOpeningOrgsRequest,
) (SuggestOrgsOutcome, error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, "opening-search/suggest-orgs")
	if err != nil {
		return SuggestOrgsOutcome{}, err
	}
	return c.suggestOrgs(ctx, endpoint, tlsConfig, query)
}

func (c *Client) search(
	ctx context.Context, endpoint string, tlsConfig *tls.Config, payload any,
	query openingsspec.OpeningSearchQuery,
) (SearchOutcome, error) {
	var result openingsspec.SearchOpeningsResponse
	details, err := c.read(ctx, endpoint, payload, tlsConfig, &result)
	if err != nil || details != nil {
		return SearchOutcome{Problem: details}, err
	}
	if err := validateSearch(result, query); err != nil {
		return SearchOutcome{}, err
	}
	return SearchOutcome{Result: &result}, nil
}

func (c *Client) suggestOrgs(
	ctx context.Context, endpoint string, tlsConfig *tls.Config, payload any,
) (SuggestOrgsOutcome, error) {
	var result openingsspec.SuggestOpeningOrgsResponse
	details, err := c.read(ctx, endpoint, payload, tlsConfig, &result)
	if err != nil || details != nil {
		return SuggestOrgsOutcome{Problem: details}, err
	}
	if err := validateSuggestions(result); err != nil {
		return SuggestOrgsOutcome{}, err
	}
	return SuggestOrgsOutcome{Result: &result}, nil
}

func validPublicOrg(org openingsspec.PublicOrg) bool {
	return orgs.IsOrgDomain(org.Domain) && common.IsDisplayName(org.DisplayName) &&
		common.IsCountryCode(org.Country) && (org.LogoURL == nil || *org.LogoURL != "")
}

func validateSearch(
	result openingsspec.SearchOpeningsResponse, query openingsspec.OpeningSearchQuery,
) error {
	if result.Openings == nil || len(result.Openings) > int(query.EffectiveLimit()) ||
		(result.NextPaginationKey != nil &&
			!common.IsPaginationKey(*result.NextPaginationKey)) {
		return ErrInvalidResponse
	}
	for _, item := range result.Openings {
		opening := item.Opening
		if !validPublicOrg(item.Org) ||
			(query.OrgDomain != nil && item.Org.Domain != *query.OrgDomain) ||
			opening.OpeningNumber < 1 || opening.Title == "" ||
			!common.IsCountryCode(opening.EmployingCountry) ||
			opening.WorkArrangement == "" || opening.EmploymentType == "" ||
			opening.FirstPublishedAt.IsZero() || opening.Tags == nil {
			return ErrInvalidResponse
		}
		if opening.Salary != nil && !common.IsCurrencyCode(opening.Salary.Currency) {
			return ErrInvalidResponse
		}
	}
	return nil
}

func validateSuggestions(result openingsspec.SuggestOpeningOrgsResponse) error {
	if result.Orgs == nil || len(result.Orgs) > openingsspec.MaxOpeningOrgSuggestions {
		return ErrInvalidResponse
	}
	for _, org := range result.Orgs {
		if !validPublicOrg(org) {
			return ErrInvalidResponse
		}
	}
	return nil
}
