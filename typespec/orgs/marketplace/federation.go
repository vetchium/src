package marketplace

import (
	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/hiring"
)

const maxSortName = 400

// ListingSearchPosition is where the next page of a merged search resumes:
// after this provider name, case-folded by the tenant that holds it, then
// this domain.
type ListingSearchPosition struct {
	SortName string         `json:"sort_name"`
	Domain   orgs.OrgDomain `json:"domain"`
}

// PeerSearchListingsRequest is one tenant's share of a Listing search. No
// caller identity crosses the mesh.
type PeerSearchListingsRequest struct {
	Capability Capability             `json:"capability"`
	Country    *common.CountryCode    `json:"country,omitempty"`
	Language   *common.LanguageTag    `json:"language,omitempty"`
	CheckTypes []hiring.CheckType     `json:"check_types,omitempty"`
	Query      *string                `json:"query,omitempty"`
	After      *ListingSearchPosition `json:"after,omitempty"`
	Limit      int32                  `json:"limit"`
}

func (r *PeerSearchListingsRequest) Normalize() {
	search := SearchListingsRequest{
		Country: r.Country, Language: r.Language, Query: r.Query,
	}
	search.Normalize()
	r.Country, r.Language, r.Query = search.Country, search.Language, search.Query
	if r.After != nil {
		after := *r.After
		after.Domain = orgs.NormalizeOrgDomain(after.Domain)
		r.After = &after
	}
}

func (r PeerSearchListingsRequest) Validate() []string {
	search := SearchListingsRequest{
		Capability: r.Capability, Country: r.Country, Language: r.Language,
		CheckTypes: r.CheckTypes, Query: r.Query,
	}
	fields := search.Validate()
	if r.After != nil {
		n := textLength(r.After.SortName)
		if n < 1 || n > maxSortName || !storable(r.After.SortName) {
			fields = append(fields, "after.sort_name")
		}
		if !orgs.IsOrgDomain(r.After.Domain) {
			fields = append(fields, "after.domain")
		}
	}
	if r.Limit < 1 || r.Limit > MaxSearchPage {
		fields = append(fields, "limit")
	}
	return fields
}

// PeerListingSummary is a Listing with the case-folded provider name the
// tenant ordered it by.
type PeerListingSummary struct {
	SortName string         `json:"sort_name"`
	Listing  ListingSummary `json:"listing"`
}

type PeerSearchListingsResponse struct {
	Listings []PeerListingSummary `json:"listings"`
	// HasMore reports more matches after the last one returned.
	HasMore bool `json:"has_more"`
}

// RelaySearchListingsRequest asks the local relay to search Tenant, which may
// be the relay's own tenant.
type RelaySearchListingsRequest struct {
	Tenant directoryspec.TenantID    `json:"tenant"`
	Search PeerSearchListingsRequest `json:"search"`
}

func (r *RelaySearchListingsRequest) Normalize() { r.Search.Normalize() }

func (r RelaySearchListingsRequest) Validate() []string {
	fields := []string{}
	if !directoryspec.IsTenantID(r.Tenant) {
		fields = append(fields, "tenant")
	}
	for _, field := range r.Search.Validate() {
		fields = append(fields, "search."+field)
	}
	return fields
}

type RelayGetListingRequest struct {
	Tenant  directoryspec.TenantID `json:"tenant"`
	Listing GetListingRequest      `json:"listing"`
}

func (r *RelayGetListingRequest) Normalize() { r.Listing.Normalize() }

func (r RelayGetListingRequest) Validate() []string {
	fields := []string{}
	if !directoryspec.IsTenantID(r.Tenant) {
		fields = append(fields, "tenant")
	}
	for _, field := range r.Listing.Validate() {
		fields = append(fields, "listing."+field)
	}
	return fields
}
