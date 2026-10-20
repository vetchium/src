package listings

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"
	directoryproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

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

// GetListing reads a provider's `listed` Listing. This tenant is asked first,
// so a local provider needs no directory lookup; otherwise the directory names
// the provider's tenant.
func GetListing(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.GetListingRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), s.ListingDeadline)
		defer cancel()
		self := directoryspec.TenantID(s.TenantID)
		detail, details := readListing(ctx, s, self, request)
		if details != nil && details.Type == orgsproblem.ListingNotFoundError.Type {
			home, homeDetails := homeTenant(ctx, s, request)
			if homeDetails != nil {
				details = homeDetails
			} else if home != self {
				detail, details = readListing(ctx, s, home, request)
			}
		}
		if details != nil {
			s.Problem(r.Context(), w, *details)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, *detail)
	}
}

func readListing(
	ctx context.Context, s *orgsruntime.Server, tenant directoryspec.TenantID,
	request marketplace.GetListingRequest,
) (*marketplace.ListingDetail, *problem.Details) {
	outcome, err := s.Listings.RelayGet(ctx, marketplace.RelayGetListingRequest{
		Tenant: tenant, Listing: request,
	})
	if err != nil {
		s.WarnContext(ctx, "Listing read failed",
			"event", "listing_read_failed", "peer_tenant", tenant, "error", err)
		return nil, &orgsproblem.TenantUnavailableError
	}
	if outcome.Problem != nil {
		if outcome.Problem.Type == orgsproblem.ListingNotFoundError.Type {
			return nil, &orgsproblem.ListingNotFoundError
		}
		return nil, &orgsproblem.TenantUnavailableError
	}
	return outcome.Result, nil
}

// homeTenant asks the global directory where the provider's domain lives.
// An unknown domain is a Listing that does not exist.
func homeTenant(
	ctx context.Context, s *orgsruntime.Server,
	request marketplace.GetListingRequest,
) (directoryspec.TenantID, *problem.Details) {
	resolved, details, err := s.Directory.ResolveOrgDomain(
		ctx, directoryspec.ResolveOrgDomainRequest{Domain: request.Domain},
	)
	if err != nil || (details != nil &&
		details.Type != directoryproblem.DirectoryEntryNotFoundError.Type) ||
		(details == nil && resolved.Domain != request.Domain) {
		return "", &orgsproblem.TenantUnavailableError
	}
	if details != nil {
		return "", &orgsproblem.ListingNotFoundError
	}
	return resolved.HomeTenantID, nil
}
