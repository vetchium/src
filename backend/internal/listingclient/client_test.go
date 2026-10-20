package listingclient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"
)

func summary(name, domain string) marketplace.PeerListingSummary {
	return marketplace.PeerListingSummary{
		SortName: name,
		Listing: marketplace.ListingSummary{
			Provider: marketplace.ListingProvider{
				Domain: orgs.OrgDomain(domain), DisplayName: name, Country: "SG",
			},
			Capability: marketplace.Sourcing, Headline: "H",
			Service:   marketplace.ServiceArea{Worldwide: true, Countries: []common.CountryCode{}},
			Languages: []common.LanguageTag{},
		},
	}
}

func serve(t *testing.T, status int, contentType string, body any) *Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", contentType)
		w.WriteHeader(status)
		data, _ := json.Marshal(body)
		_, _ = w.Write(data)
	}))
	t.Cleanup(server.Close)
	return NewRelay(server.URL, "secret", time.Second)
}

func relaySearch(limit int32) marketplace.RelaySearchListingsRequest {
	return marketplace.RelaySearchListingsRequest{
		Tenant: "sgp",
		Search: marketplace.PeerSearchListingsRequest{Capability: marketplace.Sourcing, Limit: limit},
	}
}

func TestRelaySearchReturnsAValidPage(t *testing.T) {
	t.Parallel()
	client := serve(t, 200, "application/json", marketplace.PeerSearchListingsResponse{
		Listings: []marketplace.PeerListingSummary{summary("a", "a.test"), summary("b", "b.test")},
		HasMore:  true,
	})
	outcome, err := client.RelaySearch(context.Background(), relaySearch(2))
	if err != nil || outcome.Result == nil || len(outcome.Result.Listings) != 2 || !outcome.Result.HasMore {
		t.Fatalf("outcome = %+v, %v", outcome, err)
	}
}

func TestRelaySearchReturnsAProblem(t *testing.T) {
	t.Parallel()
	client := serve(t, 503, problem.MediaType, problem.Details{
		Type: "vetchium-problem-details/org-tenant-unavailable", Status: 503,
	})
	outcome, err := client.RelaySearch(context.Background(), relaySearch(2))
	if err != nil || outcome.Problem == nil || outcome.Problem.Status != 503 || outcome.Result != nil {
		t.Fatalf("outcome = %+v, %v", outcome, err)
	}
	client = serve(t, 200, problem.MediaType, problem.Details{
		Type: "x", Status: 503,
	})
	if _, err := client.RelaySearch(context.Background(), relaySearch(2)); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("inconsistent problem error = %v", err)
	}
}

func TestRelaySearchHoldsATenantToItsContract(t *testing.T) {
	t.Parallel()
	good := summary("b", "b.test")
	wrongCapability := summary("a", "a.test")
	wrongCapability.Listing.Capability = marketplace.Assessment
	noLanguages := summary("a", "a.test")
	noLanguages.Listing.Languages = nil
	tests := []struct {
		name    string
		listing []marketplace.PeerListingSummary
		limit   int32
	}{
		{"over the limit", []marketplace.PeerListingSummary{summary("a", "a.test"), good}, 1},
		{"out of order", []marketplace.PeerListingSummary{good, summary("a", "a.test")}, 5},
		{"duplicate position", []marketplace.PeerListingSummary{good, good}, 5},
		{"wrong capability", []marketplace.PeerListingSummary{wrongCapability}, 5},
		{"null arrays", []marketplace.PeerListingSummary{noLanguages}, 5},
		{"invalid domain", []marketplace.PeerListingSummary{summary("a", "not a domain")}, 5},
		{"blank sort name", []marketplace.PeerListingSummary{summary("", "a.test")}, 5},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			client := serve(t, 200, "application/json", marketplace.PeerSearchListingsResponse{Listings: test.listing})
			if _, err := client.RelaySearch(context.Background(), relaySearch(test.limit)); !errors.Is(err, ErrInvalidResponse) {
				t.Fatalf("error = %v", err)
			}
		})
	}
	t.Run("not after the cursor", func(t *testing.T) {
		t.Parallel()
		client := serve(t, 200, "application/json", marketplace.PeerSearchListingsResponse{
			Listings: []marketplace.PeerListingSummary{summary("a", "a.test")},
		})
		request := relaySearch(5)
		request.Search.After = &marketplace.ListingSearchPosition{SortName: "a", Domain: "a.test"}
		if _, err := client.RelaySearch(context.Background(), request); !errors.Is(err, ErrInvalidResponse) {
			t.Fatalf("error = %v", err)
		}
	})
}

func TestRelaySearchRejectsPrivateFields(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"listings":[],"has_more":false,"org_did":"private"}`))
	}))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	if _, err := client.RelaySearch(context.Background(), relaySearch(2)); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("private field error = %v", err)
	}
}

func TestRelayBoundsResponseAndRejectsRedirect(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/mesh/listings/search" {
			w.Header().Set("Location", "/another")
			w.WriteHeader(http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(strings.Repeat("x", maxResponseBytes+1)))
	}))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	if _, err := client.RelaySearch(context.Background(), relaySearch(2)); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("redirect error = %v", err)
	}
	_, err := client.RelayGet(context.Background(), marketplace.RelayGetListingRequest{
		Tenant: "sgp", Listing: marketplace.GetListingRequest{Domain: "a.test", Capability: marketplace.Sourcing},
	})
	if !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("oversized response error = %v", err)
	}
}

func TestRelayGetChecksTheDetailMatchesTheAsk(t *testing.T) {
	t.Parallel()
	detail := marketplace.ListingDetail{
		ListingSummary: summary("a", "a.test").Listing, Description: "D",
	}
	client := serve(t, 200, "application/json", detail)
	request := marketplace.RelayGetListingRequest{
		Tenant: "sgp", Listing: marketplace.GetListingRequest{Domain: "a.test", Capability: marketplace.Sourcing},
	}
	outcome, err := client.RelayGet(context.Background(), request)
	if err != nil || outcome.Result == nil || outcome.Result.Description != "D" {
		t.Fatalf("outcome = %+v, %v", outcome, err)
	}
	request.Listing.Domain = "other.test"
	if _, err := client.RelayGet(context.Background(), request); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("mismatched domain error = %v", err)
	}
	request.Listing.Domain = "a.test"
	request.Listing.Capability = marketplace.Assessment
	if _, err := client.RelayGet(context.Background(), request); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("mismatched Capability error = %v", err)
	}
}

func TestPeerRejectsInvalidTenantConfiguration(t *testing.T) {
	t.Parallel()
	request := marketplace.PeerSearchListingsRequest{Capability: marketplace.Sourcing, Limit: 1}
	if _, err := NewPeer(nil, time.Second).PeerSearch(context.Background(), "sgp", request); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("missing TLS error = %v", err)
	}
	if _, err := NewPeer(nil, time.Second).PeerGet(context.Background(), "bad tenant",
		marketplace.GetListingRequest{}); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("bad tenant error = %v", err)
	}
}
