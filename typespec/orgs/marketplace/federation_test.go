package marketplace

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestPeerSearchListingsRequestValidation(t *testing.T) {
	t.Parallel()
	valid := PeerSearchListingsRequest{Capability: Sourcing, Limit: 50}
	if got := valid.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	tests := []struct {
		name string
		edit func(*PeerSearchListingsRequest)
		want []string
	}{
		{"limit 0", func(r *PeerSearchListingsRequest) { r.Limit = 0 }, []string{"limit"}},
		{"limit 51", func(r *PeerSearchListingsRequest) { r.Limit = 51 }, []string{"limit"}},
		{"bad cursor name", func(r *PeerSearchListingsRequest) {
			r.After = &ListingSearchPosition{Domain: "acme.test"}
		}, []string{"after.sort_name"}},
		{"NUL in cursor name", func(r *PeerSearchListingsRequest) {
			r.After = &ListingSearchPosition{SortName: "a\x00", Domain: "acme.test"}
		}, []string{"after.sort_name"}},
		{"bad cursor domain", func(r *PeerSearchListingsRequest) {
			r.After = &ListingSearchPosition{SortName: "a", Domain: "x"}
		}, []string{"after.domain"}},
		{"bad filter", func(r *PeerSearchListingsRequest) {
			country := common.CountryCode("zz")
			r.Country = &country
		}, []string{"country"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := valid
			test.edit(&request)
			if got := request.Validate(); !slices.Equal(got, test.want) {
				t.Fatalf("fields = %v, want %v", got, test.want)
			}
		})
	}
}

func TestRelayRequestsPrefixNestedFields(t *testing.T) {
	t.Parallel()
	search := RelaySearchListingsRequest{Tenant: "Bad", Search: PeerSearchListingsRequest{Capability: "x", Limit: 0}}
	want := []string{"tenant", "search.capability", "search.limit"}
	if got := search.Validate(); !slices.Equal(got, want) {
		t.Fatalf("search fields = %v, want %v", got, want)
	}
	get := RelayGetListingRequest{Tenant: "sgp", Listing: GetListingRequest{Domain: "x", Capability: Sourcing}}
	if got := get.Validate(); !slices.Equal(got, []string{"listing.domain"}) {
		t.Fatalf("get fields = %v", got)
	}
	get.Listing.Domain = " ACME.test "
	get.Normalize()
	if get.Listing.Domain != "acme.test" || len(get.Validate()) != 0 {
		t.Fatalf("unexpected request %+v", get)
	}
}

func TestPeerSearchNormalizeDoesNotMutateTheCaller(t *testing.T) {
	t.Parallel()
	query := " ab "
	request := PeerSearchListingsRequest{Capability: Sourcing, Query: &query, Limit: 1,
		After: &ListingSearchPosition{SortName: "a", Domain: " ACME.test "}}
	original := request.After
	request.Normalize()
	if *request.Query != "ab" || request.After.Domain != "acme.test" {
		t.Fatalf("unexpected normalization: %+v", request)
	}
	if original.Domain != " ACME.test " {
		t.Fatal("normalization mutated the caller's cursor")
	}
}
