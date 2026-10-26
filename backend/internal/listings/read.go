// Package listings builds the public Listing representation at a provider's
// home tenant for mesh reads, local and from peers. A Listing is readable while
// it is `listed`, its Org is active, and its plan allows Listings.
package listings

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/marketplace"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

var ErrNotFound = errors.New("listing not found")

type Queries interface {
	SearchPublicListings(
		context.Context, sqlc.SearchPublicListingsParams,
	) ([]sqlc.SearchPublicListingsRow, error)
	GetPublicListing(
		context.Context, sqlc.GetPublicListingParams,
	) (sqlc.GetPublicListingRow, error)
	GetEngagementListingForConsumer(
		context.Context, sqlc.GetEngagementListingForConsumerParams,
	) (sqlc.GetEngagementListingForConsumerRow, error)
}

type LogoSigner interface {
	SignLogoGet(context.Context, pgtype.UUID) (string, error)
}

type Reader struct {
	Queries Queries
	Logos   LogoSigner
	// ListingPlanOIDs and LogoPlanOIDs come from the plan entitlements, so a
	// plan change is the only place a decision about them is made.
	ListingPlanOIDs []string
	LogoPlanOIDs    []string
}

func optional(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func (r Reader) provider(
	ctx context.Context, domain, displayName, country string,
	logoID pgtype.UUID,
) (marketplace.ListingProvider, error) {
	provider := marketplace.ListingProvider{
		Domain: orgs.OrgDomain(domain), DisplayName: displayName,
		Country: common.CountryCode(country),
	}
	if logoID.Valid {
		if r.Logos == nil {
			return provider, fmt.Errorf("org logo signer unavailable")
		}
		url, err := r.Logos.SignLogoGet(ctx, logoID)
		if err != nil {
			return provider, fmt.Errorf("sign Org logo: %w", err)
		}
		provider.LogoURL = &url
	}
	return provider, nil
}

func countries(values []string) []common.CountryCode {
	result := make([]common.CountryCode, len(values))
	for index, value := range values {
		result[index] = common.CountryCode(value)
	}
	return result
}

func languages(values []string) []common.LanguageTag {
	result := make([]common.LanguageTag, len(values))
	for index, value := range values {
		result[index] = common.LanguageTag(value)
	}
	return result
}

// checkTypes returns nil for a Listing that performs none, which the wire
// omits.
func checkTypes(values []string) []hiring.CheckType {
	if len(values) == 0 {
		return nil
	}
	result := make([]hiring.CheckType, len(values))
	for index, value := range values {
		result[index] = hiring.CheckType(value)
	}
	return result
}

// Search returns one tenant's share of a search: up to request.Limit matches
// after request.After and whether more follow.
func (r Reader) Search(
	ctx context.Context, request marketplace.PeerSearchListingsRequest,
) (marketplace.PeerSearchListingsResponse, error) {
	params := sqlc.SearchPublicListingsParams{
		CapabilityOid:   string(request.Capability),
		ListingPlanOids: r.ListingPlanOIDs, LogoPlanOids: r.LogoPlanOIDs,
		PageLimit: request.Limit + 1,
	}
	if request.Country != nil {
		params.Country = dbvalue.Text(string(*request.Country))
	}
	if request.Language != nil {
		params.Language = dbvalue.Text(string(*request.Language))
	}
	if request.CheckTypes != nil {
		params.CheckTypes = make([]string, len(request.CheckTypes))
		for index, value := range request.CheckTypes {
			params.CheckTypes[index] = string(value)
		}
	}
	params.Query = dbvalue.NullText(request.Query)
	if request.After != nil {
		params.AfterName = dbvalue.Text(request.After.SortName)
		params.AfterDomain = dbvalue.Text(string(request.After.Domain))
	}
	rows, err := r.Queries.SearchPublicListings(ctx, params)
	if err != nil {
		return marketplace.PeerSearchListingsResponse{}, fmt.Errorf("search Listings: %w", err)
	}
	response := marketplace.PeerSearchListingsResponse{
		Listings: make([]marketplace.PeerListingSummary, 0, len(rows)),
	}
	if len(rows) > int(request.Limit) {
		response.HasMore = true
		rows = rows[:request.Limit]
	}
	for _, row := range rows {
		provider, err := r.provider(
			ctx, row.Domain, row.DisplayName, row.Country, row.LogoObjectID,
		)
		if err != nil {
			return marketplace.PeerSearchListingsResponse{}, err
		}
		response.Listings = append(response.Listings, marketplace.PeerListingSummary{
			SortName: row.SortName,
			Listing: marketplace.ListingSummary{
				Provider:   provider,
				Capability: marketplace.Capability(row.CapabilityOid),
				Headline:   row.Headline,
				Service: marketplace.ServiceArea{
					Worldwide: row.ServiceWorldwide,
					Countries: countries(row.ServiceCountries),
				},
				Languages:       languages(row.Languages),
				IndicativePrice: optional(row.IndicativePrice),
				CheckTypes:      checkTypes(row.CheckTypes),
			},
		})
	}
	return response, nil
}

// Get returns a `listed` Listing by its provider's domain and Capability.
func (r Reader) Get(
	ctx context.Context, request marketplace.GetListingRequest,
) (marketplace.ListingDetail, error) {
	row, err := r.Queries.GetPublicListing(ctx, sqlc.GetPublicListingParams{
		Domain: string(request.Domain), CapabilityOid: string(request.Capability),
		ListingPlanOids: r.ListingPlanOIDs, LogoPlanOids: r.LogoPlanOIDs,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return marketplace.ListingDetail{}, ErrNotFound
	}
	if err != nil {
		return marketplace.ListingDetail{}, fmt.Errorf("get Listing: %w", err)
	}
	provider, err := r.provider(
		ctx, row.Domain, row.DisplayName, row.Country, row.LogoObjectID,
	)
	if err != nil {
		return marketplace.ListingDetail{}, err
	}
	return marketplace.ListingDetail{
		ListingSummary: marketplace.ListingSummary{
			Provider:   provider,
			Capability: marketplace.Capability(row.CapabilityOid),
			Headline:   row.Headline,
			Service: marketplace.ServiceArea{
				Worldwide: row.ServiceWorldwide,
				Countries: countries(row.ServiceCountries),
			},
			Languages:       languages(row.Languages),
			IndicativePrice: optional(row.IndicativePrice),
			CheckTypes:      checkTypes(row.CheckTypes),
		},
		Description:       row.Description,
		ConsentDisclosure: optional(row.ConsentDisclosure),
	}, nil
}

// EngagementListing returns the Listing behind an engagement this tenant
// holds as provider, whatever its state, to the consumer the engagement
// names.
func (r Reader) EngagementListing(
	ctx context.Context, request marketplace.PeerEngagementListingRequest,
) (marketplace.EngagementListing, error) {
	engagementID, err := dbvalue.ParseUUID(string(request.EngagementID))
	if err != nil {
		return marketplace.EngagementListing{}, err
	}
	consumerDID, err := dbvalue.ParseUUID(string(request.ConsumerOrgDID))
	if err != nil {
		return marketplace.EngagementListing{}, err
	}
	row, err := r.Queries.GetEngagementListingForConsumer(ctx,
		sqlc.GetEngagementListingForConsumerParams{
			EngagementID: engagementID, ConsumerOrgDid: consumerDID,
		})
	if errors.Is(err, pgx.ErrNoRows) {
		return marketplace.EngagementListing{}, ErrNotFound
	}
	if err != nil {
		return marketplace.EngagementListing{}, fmt.Errorf("get engagement Listing: %w", err)
	}
	return marketplace.EngagementListing{
		Capability:        marketplace.Capability(row.CapabilityOid),
		CheckTypes:        checkTypes(row.CheckTypes),
		ConsentDisclosure: optional(row.ConsentDisclosure),
	}, nil
}
