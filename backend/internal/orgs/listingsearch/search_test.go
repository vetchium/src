package listingsearch

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/listingclient"
)

type fakePeers struct {
	answers map[directoryspec.TenantID]marketplace.PeerSearchListingsResponse
	failing map[directoryspec.TenantID]error
	problem map[directoryspec.TenantID]bool
	slow    map[directoryspec.TenantID]bool
	seen    chan marketplace.RelaySearchListingsRequest
}

func (f fakePeers) RelaySearch(
	ctx context.Context, request marketplace.RelaySearchListingsRequest,
) (listingclient.SearchOutcome, error) {
	f.seen <- request
	if f.slow[request.Tenant] {
		<-ctx.Done()
		return listingclient.SearchOutcome{}, ctx.Err()
	}
	if err := f.failing[request.Tenant]; err != nil {
		return listingclient.SearchOutcome{}, err
	}
	if f.problem[request.Tenant] {
		return listingclient.SearchOutcome{Problem: &problem.Details{Status: 503}}, nil
	}
	result := f.answers[request.Tenant]
	return listingclient.SearchOutcome{Result: &result}, nil
}

func entry(name, domain string) marketplace.PeerListingSummary {
	return marketplace.PeerListingSummary{
		SortName: name,
		Listing: marketplace.ListingSummary{
			Provider: marketplace.ListingProvider{Domain: orgs.OrgDomain(domain)},
		},
	}
}

func domains(page Page) []string {
	result := []string{}
	for _, e := range page.Entries {
		result = append(result, string(e.Listing.Provider.Domain))
	}
	return result
}

func searcher(peers fakePeers, tenants ...directoryspec.TenantID) Searcher {
	return Searcher{Peers: peers, Tenants: tenants, Deadline: 200 * time.Millisecond}
}

func request(limit int32) marketplace.PeerSearchListingsRequest {
	return marketplace.PeerSearchListingsRequest{Capability: marketplace.Sourcing, Limit: limit}
}

func TestSearchMergesTenantsByNameThenDomain(t *testing.T) {
	t.Parallel()
	peers := fakePeers{
		seen: make(chan marketplace.RelaySearchListingsRequest, 8),
		answers: map[directoryspec.TenantID]marketplace.PeerSearchListingsResponse{
			"sgp": {Listings: []marketplace.PeerListingSummary{
				entry("acme", "acme.sg.test"), entry("zed", "zed.test"),
			}},
			"usa1": {Listings: []marketplace.PeerListingSummary{
				entry("acme", "acme.com.test"), entry("beta", "beta.test"),
			}},
		},
	}
	page := searcher(peers, "sgp", "usa1").Search(context.Background(), request(10))
	want := []string{"acme.com.test", "acme.sg.test", "beta.test", "zed.test"}
	if !slices.Equal(domains(page), want) || page.HasMore || len(page.Unavailable) != 0 {
		t.Fatalf("page = %v more=%v unavailable=%v", domains(page), page.HasMore, page.Unavailable)
	}
	asked := map[directoryspec.TenantID]bool{}
	for range 2 {
		got := <-peers.seen
		asked[got.Tenant] = true
		if got.Search.Limit != 10 {
			t.Fatalf("tenant %s asked for limit %d", got.Tenant, got.Search.Limit)
		}
	}
	if !asked["sgp"] || !asked["usa1"] {
		t.Fatalf("asked = %v", asked)
	}
}

func TestSearchTrimsToTheLimitAndReportsMore(t *testing.T) {
	t.Parallel()
	peers := fakePeers{
		seen: make(chan marketplace.RelaySearchListingsRequest, 8),
		answers: map[directoryspec.TenantID]marketplace.PeerSearchListingsResponse{
			"sgp":  {Listings: []marketplace.PeerListingSummary{entry("a", "a.test"), entry("c", "c.test")}},
			"usa1": {Listings: []marketplace.PeerListingSummary{entry("b", "b.test"), entry("d", "d.test")}},
		},
	}
	page := searcher(peers, "sgp", "usa1").Search(context.Background(), request(3))
	if !slices.Equal(domains(page), []string{"a.test", "b.test", "c.test"}) || !page.HasMore {
		t.Fatalf("page = %v more=%v", domains(page), page.HasMore)
	}
}

func TestSearchReportsMoreWhenOnlyATenantHasMore(t *testing.T) {
	t.Parallel()
	peers := fakePeers{
		seen: make(chan marketplace.RelaySearchListingsRequest, 8),
		answers: map[directoryspec.TenantID]marketplace.PeerSearchListingsResponse{
			"sgp": {Listings: []marketplace.PeerListingSummary{entry("a", "a.test")}, HasMore: true},
		},
	}
	page := searcher(peers, "sgp").Search(context.Background(), request(1))
	if len(page.Entries) != 1 || !page.HasMore {
		t.Fatalf("page = %v more=%v", domains(page), page.HasMore)
	}
}

func TestSearchNamesTenantsThatFailedOrTimedOut(t *testing.T) {
	t.Parallel()
	peers := fakePeers{
		seen: make(chan marketplace.RelaySearchListingsRequest, 8),
		answers: map[directoryspec.TenantID]marketplace.PeerSearchListingsResponse{
			"sgp": {Listings: []marketplace.PeerListingSummary{entry("a", "a.test")}},
		},
		failing: map[directoryspec.TenantID]error{"deu": errors.New("refused")},
		problem: map[directoryspec.TenantID]bool{"usa1": true},
		slow:    map[directoryspec.TenantID]bool{"ind1": true},
	}
	start := time.Now()
	page := searcher(peers, "sgp", "usa1", "deu", "ind1").Search(context.Background(), request(5))
	if time.Since(start) > 2*time.Second {
		t.Fatal("search outlived its deadline")
	}
	if !slices.Equal(domains(page), []string{"a.test"}) {
		t.Fatalf("page = %v", domains(page))
	}
	want := []directoryspec.TenantID{"deu", "ind1", "usa1"}
	if !slices.Equal(page.Unavailable, want) {
		t.Fatalf("unavailable = %v, want %v", page.Unavailable, want)
	}
}

func TestSearchWithNoMatchesHoldsNonNilSlices(t *testing.T) {
	t.Parallel()
	peers := fakePeers{
		seen:    make(chan marketplace.RelaySearchListingsRequest, 8),
		answers: map[directoryspec.TenantID]marketplace.PeerSearchListingsResponse{"sgp": {}},
	}
	page := searcher(peers, "sgp").Search(context.Background(), request(5))
	if page.Entries == nil || page.Unavailable == nil || page.HasMore {
		t.Fatalf("page = %+v", page)
	}
}
