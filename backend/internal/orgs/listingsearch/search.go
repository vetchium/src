// Package listingsearch asks every tenant for matching Listings in parallel,
// under one deadline, and merges the answers into one ordered page.
package listingsearch

import (
	"context"
	"slices"
	"strings"
	"sync"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs/marketplace"

	"backend/internal/listingclient"
)

// Peers searches one tenant through the local relay.
type Peers interface {
	RelaySearch(
		context.Context, marketplace.RelaySearchListingsRequest,
	) (listingclient.SearchOutcome, error)
}

type Searcher struct {
	Peers Peers
	// Tenants is every tenant on the mesh, this one included.
	Tenants []directoryspec.TenantID
	// Deadline bounds the whole fan-out; a tenant still silent then is
	// unavailable.
	Deadline time.Duration
}

// Page is one merged page. Entries hold at most the requested limit.
type Page struct {
	Entries []marketplace.PeerListingSummary
	HasMore bool
	// Unavailable names the tenants that gave no usable answer, sorted.
	Unavailable []directoryspec.TenantID
}

type answer struct {
	tenant directoryspec.TenantID
	result *marketplace.PeerSearchListingsResponse
}

// Search asks each tenant for up to request.Limit matches after request.After
// and keeps the first request.Limit of their union. Each tenant is asked for
// a full page, so the union holds the true next entries whichever tenant
// they come from.
func (s Searcher) Search(
	ctx context.Context, request marketplace.PeerSearchListingsRequest,
) Page {
	ctx, cancel := context.WithTimeout(ctx, s.Deadline)
	defer cancel()
	answers := make([]answer, len(s.Tenants))
	var wait sync.WaitGroup
	for index, tenant := range s.Tenants {
		wait.Add(1)
		go func() {
			defer wait.Done()
			answers[index].tenant = tenant
			outcome, err := s.Peers.RelaySearch(ctx, marketplace.RelaySearchListingsRequest{
				Tenant: tenant, Search: request,
			})
			if err == nil && outcome.Problem == nil {
				answers[index].result = outcome.Result
			}
		}()
	}
	wait.Wait()

	page := Page{Unavailable: []directoryspec.TenantID{}}
	var merged []marketplace.PeerListingSummary
	for _, answer := range answers {
		if answer.result == nil {
			page.Unavailable = append(page.Unavailable, answer.tenant)
			continue
		}
		merged = append(merged, answer.result.Listings...)
		page.HasMore = page.HasMore || answer.result.HasMore
	}
	slices.Sort(page.Unavailable)
	slices.SortFunc(merged, func(a, b marketplace.PeerListingSummary) int {
		if c := strings.Compare(a.SortName, b.SortName); c != 0 {
			return c
		}
		return strings.Compare(
			string(a.Listing.Provider.Domain), string(b.Listing.Provider.Domain),
		)
	})
	if len(merged) > int(request.Limit) {
		merged = merged[:request.Limit]
		page.HasMore = true
	}
	page.Entries = merged
	if page.Entries == nil {
		page.Entries = []marketplace.PeerListingSummary{}
	}
	return page
}
