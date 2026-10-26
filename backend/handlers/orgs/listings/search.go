package listings

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	orgsruntime "backend/internal/orgs"
)

const searchPaginationPurpose = "orgs-search-listings-v1"

// searchFilters are the normalized filters a pagination key is bound to, so a
// key cannot resume a different search.
type searchFilters struct {
	Capability string   `json:"capability"`
	Country    string   `json:"country,omitempty"`
	Language   string   `json:"language,omitempty"`
	CheckTypes []string `json:"check_types,omitempty"`
	Query      string   `json:"query,omitempty"`
}

type searchCursor struct {
	Filters     searchFilters `json:"filters"`
	AfterName   string        `json:"after_name"`
	AfterDomain string        `json:"after_domain"`
}

func filtersOf(request marketplace.SearchListingsRequest) searchFilters {
	filters := searchFilters{Capability: string(request.Capability)}
	if request.Country != nil {
		filters.Country = string(*request.Country)
	}
	if request.Language != nil {
		filters.Language = string(*request.Language)
	}
	if request.CheckTypes != nil {
		filters.CheckTypes = make([]string, len(request.CheckTypes))
		for index, value := range request.CheckTypes {
			filters.CheckTypes[index] = string(value)
		}
	}
	if request.Query != nil {
		filters.Query = *request.Query
	}
	return filters
}

func SearchListings(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.SearchListingsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		filters := filtersOf(request)
		peer := marketplace.PeerSearchListingsRequest{
			Capability: request.Capability, Country: request.Country,
			Language: request.Language, CheckTypes: request.CheckTypes,
			Query: request.Query, Limit: request.EffectiveLimit(),
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), searchPaginationPurpose,
				string(*request.PaginationKey),
			)
			var cursor searchCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil ||
				!reflect.DeepEqual(cursor.Filters, filters) {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			peer.After = &marketplace.ListingSearchPosition{
				SortName: cursor.AfterName,
				Domain:   orgs.OrgDomain(cursor.AfterDomain),
			}
			if len(peer.Validate()) != 0 {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
		}
		page := s.ListingSearch.Search(r.Context(), peer)
		response := marketplace.SearchListingsResponse{
			Listings:           make([]marketplace.ListingSummary, 0, len(page.Entries)),
			UnavailableTenants: page.Unavailable,
		}
		for _, entry := range page.Entries {
			response.Listings = append(response.Listings, entry.Listing)
		}
		if page.HasMore && len(page.Entries) > 0 {
			last := page.Entries[len(page.Entries)-1]
			payload, err := json.Marshal(searchCursor{
				Filters: filters, AfterName: last.SortName,
				AfterDomain: string(last.Listing.Provider.Domain),
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode Listing search cursor", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), searchPaginationPurpose, payload,
			))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// GetListing reads a provider's `listed` Listing, in this tenant or another.
func GetListing(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.GetListingRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), s.ListingDeadline)
		defer cancel()
		detail, details := s.ListingRead.Get(ctx, request)
		if details != nil {
			s.Problem(r.Context(), w, *details)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, *detail)
	}
}
