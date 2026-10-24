package listings

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"
	directoryproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/listingclient"
	orgsruntime "backend/internal/orgs"
	"backend/internal/orgs/listingread"
	"backend/internal/orgs/listingsearch"
)

type relay struct {
	mu    sync.Mutex
	asked []marketplace.RelaySearchListingsRequest
	gets  []directoryspec.TenantID
}

func entry(name, domain string) marketplace.PeerListingSummary {
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

// newRelay serves the local relay: usa1 never answers, sgp holds a and c, deu
// holds b. Listing detail exists only at deu.
func newRelay(t *testing.T) (*listingclient.Client, *relay) {
	t.Helper()
	state := &relay{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		writeProblem := func(status int, details problem.Details) {
			w.Header().Set("Content-Type", problem.MediaType)
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(details)
		}
		state.mu.Lock()
		defer state.mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/search") {
			var request marketplace.RelaySearchListingsRequest
			_ = json.Unmarshal(body, &request)
			state.asked = append(state.asked, request)
			var response marketplace.PeerSearchListingsResponse
			switch request.Tenant {
			case "sgp":
				response.Listings = []marketplace.PeerListingSummary{entry("a", "a.test"), entry("c", "c.test")}
			case "deu":
				response.Listings = []marketplace.PeerListingSummary{entry("b", "b.test")}
			default:
				writeProblem(503, orgsproblem.TenantUnavailableError)
				return
			}
			response.Listings = afterCursor(response.Listings, request.Search.After)
			if len(response.Listings) > int(request.Search.Limit) {
				response.Listings = response.Listings[:request.Search.Limit]
				response.HasMore = true
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(response)
			return
		}
		var request marketplace.RelayGetListingRequest
		_ = json.Unmarshal(body, &request)
		state.gets = append(state.gets, request.Tenant)
		switch request.Tenant {
		case "deu":
			detail := marketplace.ListingDetail{ListingSummary: entry("b", "b.test").Listing, Description: "D"}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(detail)
		case "usa1":
			writeProblem(503, orgsproblem.TenantUnavailableError)
		default:
			writeProblem(404, orgsproblem.ListingNotFoundError)
		}
	}))
	t.Cleanup(server.Close)
	return listingclient.NewRelay(server.URL, "secret", time.Second), state
}

func afterCursor(
	entries []marketplace.PeerListingSummary, after *marketplace.ListingSearchPosition,
) []marketplace.PeerListingSummary {
	if after == nil {
		return entries
	}
	kept := []marketplace.PeerListingSummary{}
	for _, e := range entries {
		if e.SortName > after.SortName {
			kept = append(kept, e)
		}
	}
	return kept
}

type directoryStub struct {
	tenant  directoryspec.TenantID
	details *problem.Details
	err     error
}

func (d directoryStub) ResolvePrincipal(
	_ context.Context, request directoryspec.ResolvePrincipalRequest,
) (directoryspec.ResolvePrincipalResponse, *problem.Details, error) {
	return directoryspec.ResolvePrincipalResponse{
		PrincipalType: request.PrincipalType, PrincipalDID: request.PrincipalDID,
		HomeTenantID: d.tenant, RoutingVersion: 1,
	}, d.details, d.err
}

func (d directoryStub) ResolveOrgDomain(
	_ context.Context, request directoryspec.ResolveOrgDomainRequest,
) (directoryspec.ResolveOrgDomainResponse, *problem.Details, error) {
	return directoryspec.ResolveOrgDomainResponse{
		OrgDID: "01900000-0000-7000-8000-000000000001",
		Domain: request.Domain, HomeTenantID: d.tenant,
	}, d.details, d.err
}

// localOrgs holds no Org: every provider is found through the directory.
type localOrgs struct{}

func (localOrgs) GetLocalOrgForDomain(context.Context, string) (pgtype.UUID, error) {
	return pgtype.UUID{}, pgx.ErrNoRows
}

func (localOrgs) IsLocalFederationPrincipal(
	context.Context, sqlc.IsLocalFederationPrincipalParams,
) (bool, error) {
	return false, nil
}

func server(t *testing.T, directory directoryStub) (*orgsruntime.Server, *relay) {
	t.Helper()
	client, state := newRelay(t)
	s := &orgsruntime.Server{
		Runtime:       apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		Directory:     directory,
		TenantID:      "sgp",
		CredentialKey: [32]byte{1},
		ListingRead: listingread.Reader{
			Listings: client, Directory: directory, Orgs: localOrgs{},
			TenantID: "sgp", Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		},
		ListingDeadline: time.Second,
		ListingSearch: listingsearch.Searcher{
			Peers: client, Tenants: []directoryspec.TenantID{"sgp", "deu", "usa1"},
			Deadline: time.Second,
		},
	}
	return s, state
}

func call(handler http.HandlerFunc, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler(recorder, request)
	return recorder
}

func domainsOf(t *testing.T, recorder *httptest.ResponseRecorder) (marketplace.SearchListingsResponse, []string) {
	t.Helper()
	var response marketplace.SearchListingsResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("body %q: %v", recorder.Body.String(), err)
	}
	domains := []string{}
	for _, listing := range response.Listings {
		domains = append(domains, string(listing.Provider.Domain))
	}
	return response, domains
}

func TestSearchListingsMergesTenantsAndPaginates(t *testing.T) {
	t.Parallel()
	s, state := server(t, directoryStub{})
	handler := SearchListings(s)
	recorder := call(handler, `{"capability":"sourcing","limit":2}`)
	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	first, domains := domainsOf(t, recorder)
	if strings.Join(domains, ",") != "a.test,b.test" || first.NextPaginationKey == nil ||
		len(first.UnavailableTenants) != 1 || first.UnavailableTenants[0] != "usa1" {
		t.Fatalf("first page = %+v", first)
	}
	next, _ := json.Marshal(map[string]any{
		"capability": "sourcing", "limit": 2, "pagination_key": *first.NextPaginationKey,
	})
	second, domains := domainsOf(t, call(handler, string(next)))
	if strings.Join(domains, ",") != "c.test" || second.NextPaginationKey != nil {
		t.Fatalf("second page = %+v", second)
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	resumed := 0
	for _, asked := range state.asked {
		if asked.Search.After != nil {
			resumed++
			if asked.Search.After.SortName != "b" || asked.Search.After.Domain != "b.test" {
				t.Fatalf("cursor = %+v", asked.Search.After)
			}
		}
	}
	if resumed != 3 {
		t.Fatalf("%d tenants resumed from the cursor, want 3", resumed)
	}
}

func TestSearchListingsBindsPaginationKeysToTheirFilters(t *testing.T) {
	t.Parallel()
	s, _ := server(t, directoryStub{})
	handler := SearchListings(s)
	first, _ := domainsOf(t, call(handler, `{"capability":"sourcing","limit":1}`))
	if first.NextPaginationKey == nil {
		t.Fatal("no pagination key")
	}
	key := string(*first.NextPaginationKey)
	for name, body := range map[string]string{
		"another filter":     `{"capability":"sourcing","limit":1,"query":"ab","pagination_key":"` + key + `"}`,
		"another capability": `{"capability":"assessment","limit":1,"pagination_key":"` + key + `"}`,
		"tampered":           `{"capability":"sourcing","limit":1,"pagination_key":"` + key + `x"}`,
		"forged":             `{"capability":"sourcing","limit":1,"pagination_key":"abc"}`,
	} {
		recorder := call(handler, body)
		var details problem.Details
		_ = json.Unmarshal(recorder.Body.Bytes(), &details)
		if recorder.Code != http.StatusBadRequest || details.Type != problem.InvalidPaginationKeyError.Type {
			t.Errorf("%s: status = %d body = %s", name, recorder.Code, recorder.Body.String())
		}
	}
}

func TestSearchListingsValidatesTheRequest(t *testing.T) {
	t.Parallel()
	s, _ := server(t, directoryStub{})
	for _, body := range []string{
		`{}`, `{"capability":"sourcing","limit":51}`, `{"capability":"sourcing","query":"a"}`, `{`,
	} {
		if recorder := call(SearchListings(s), body); recorder.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d", body, recorder.Code)
		}
	}
}

func TestGetListingAsksThisTenantThenTheProvidersHome(t *testing.T) {
	t.Parallel()
	const body = `{"domain":"b.test","capability":"sourcing"}`
	s, state := server(t, directoryStub{tenant: "deu"})
	recorder := call(GetListing(s), body)
	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if len(state.gets) != 2 || state.gets[0] != "sgp" || state.gets[1] != "deu" {
		t.Fatalf("tenants asked = %v", state.gets)
	}
}

func TestGetListingRefusalsAreNamed(t *testing.T) {
	t.Parallel()
	const body = `{"domain":"b.test","capability":"sourcing"}`
	notFound := &directoryproblem.DirectoryEntryNotFoundError
	other := problem.InternalServerError
	tests := []struct {
		name      string
		directory directoryStub
		status    int
		problem   string
	}{
		{"unknown domain", directoryStub{details: notFound}, 404, orgsproblem.ListingNotFoundError.Type},
		{"provider is local", directoryStub{tenant: "sgp"}, 404, orgsproblem.ListingNotFoundError.Type},
		{"home tenant silent", directoryStub{tenant: "usa1"}, 503, orgsproblem.TenantUnavailableError.Type},
		{"home tenant has no Listing", directoryStub{tenant: "ind1"}, 404, orgsproblem.ListingNotFoundError.Type},
		{"directory error", directoryStub{err: errors.New("down")}, 503, orgsproblem.TenantUnavailableError.Type},
		{"directory problem", directoryStub{details: &other}, 503, orgsproblem.TenantUnavailableError.Type},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			s, _ := server(t, test.directory)
			recorder := call(GetListing(s), body)
			var details problem.Details
			_ = json.Unmarshal(recorder.Body.Bytes(), &details)
			if recorder.Code != test.status || details.Type != test.problem {
				t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
			}
		})
	}
	s, _ := server(t, directoryStub{})
	if recorder := call(GetListing(s), `{"domain":"x","capability":"sourcing"}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid domain status = %d", recorder.Code)
	}
}
