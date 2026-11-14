package mesh

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"testing"
	"time"

	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
	"backend/internal/openingsearch"
	"backend/internal/publicopeningclient"
)

type openingSearchQueries struct{}

func (openingSearchQueries) SearchOpenings(
	context.Context, sqlc.SearchOpeningsParams,
) ([]sqlc.SearchOpeningsRow, error) {
	return []sqlc.SearchOpeningsRow{{
		Domain: "acme.test", DisplayName: "Acme", Country: "SG",
		Summary: []byte(`{"opening_number":1,"title":"Engineer",` +
			`"employing_country":"SG","work_arrangement":"hybrid",` +
			`"employment_type":"full_time",` +
			`"first_published_at":"2026-10-10T01:00:00Z","tags":[]}`),
	}}, nil
}

func (openingSearchQueries) SuggestOpeningOrgs(
	context.Context, sqlc.SuggestOpeningOrgsParams,
) ([]sqlc.SuggestOpeningOrgsRow, error) {
	return []sqlc.SuggestOpeningOrgsRow{
		{Domain: "acme.test", DisplayName: "Acme", Country: "SG"},
	}, nil
}

func openingSearchServer() *meshapi.Server {
	return &meshapi.Server{
		Runtime:    apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		TenantID:   "sgp",
		Credential: "relay-secret",
		OpeningSearch: openingsearch.Reader{
			Queries: openingSearchQueries{}, TenantID: "sgp",
		},
		// A peer client without TLS cannot reach any tenant.
		Openings: publicopeningclient.NewPeer(nil, time.Second),
	}
}

func TestRelayOpeningSearchRequiresTheRelayCredential(t *testing.T) {
	t.Parallel()
	server := openingSearchServer()
	for _, call := range []struct {
		handler http.HandlerFunc
		body    string
	}{
		{RelaySearchOpenings(server), `{"tenant_id":"sgp","query":{}}`},
		{RelaySuggestOpeningOrgs(server), `{"tenant_id":"sgp","query":{"query":"ac"}}`},
	} {
		for _, headers := range []map[string]string{nil, {"Authorization": "Bearer wrong"}} {
			recorder := postListing(call.handler, call.body, headers, context.Background())
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("%s: status = %d", call.body, recorder.Code)
			}
		}
	}
}

func TestRelayOpeningSearchValidatesTheRequest(t *testing.T) {
	t.Parallel()
	server := openingSearchServer()
	for _, call := range []struct {
		handler http.HandlerFunc
		body    string
		fields  []string
	}{
		{RelaySearchOpenings(server), `{"tenant_id":"Bad","query":{"keyword":"x"}}`,
			[]string{"tenant_id", "query.keyword"}},
		{RelaySuggestOpeningOrgs(server), `{"tenant_id":"sgp","query":{"query":"a"}}`,
			[]string{"query.query"}},
	} {
		recorder := postListing(call.handler, call.body, relayAuth, context.Background())
		var details problem.Details
		if err := json.Unmarshal(recorder.Body.Bytes(), &details); err != nil ||
			recorder.Code != http.StatusBadRequest || !slices.Equal(details.Fields, call.fields) {
			t.Fatalf("%s: status = %d body = %s", call.body, recorder.Code, recorder.Body.String())
		}
	}
}

func TestRelayOpeningSearchAnswersItsOwnTenantLocally(t *testing.T) {
	t.Parallel()
	server := openingSearchServer()
	recorder := postListing(RelaySearchOpenings(server),
		`{"tenant_id":"sgp","query":{"keyword":"engineer"}}`, relayAuth, context.Background())
	var search openingsspec.SearchOpeningsResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &search); err != nil ||
		recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" ||
		len(search.Openings) != 1 || search.Openings[0].Org.Domain != "acme.test" {
		t.Fatalf("search: status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	recorder = postListing(RelaySuggestOpeningOrgs(server),
		`{"tenant_id":"sgp","query":{"query":"ac"}}`, relayAuth, context.Background())
	var suggestions openingsspec.SuggestOpeningOrgsResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &suggestions); err != nil ||
		recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" ||
		len(suggestions.Orgs) != 1 {
		t.Fatalf("suggestions: status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	recorder = postListing(RelaySearchOpenings(server),
		`{"tenant_id":"sgp","query":{"pagination_key":"bm90LWpzb24"}}`, relayAuth, context.Background())
	if recorder.Code != http.StatusBadRequest ||
		listingProblemType(t, recorder) != problem.InvalidPaginationKeyError.Type {
		t.Fatalf("bad key: status = %d body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestRelayOpeningSearchNamesAnUnreachableRegionUnavailable(t *testing.T) {
	t.Parallel()
	server := openingSearchServer()
	for _, call := range []struct {
		handler http.HandlerFunc
		body    string
	}{
		{RelaySearchOpenings(server), `{"tenant_id":"usa1","query":{}}`},
		{RelaySuggestOpeningOrgs(server), `{"tenant_id":"usa1","query":{"query":"ac"}}`},
	} {
		recorder := postListing(call.handler, call.body, relayAuth, context.Background())
		if recorder.Code != http.StatusServiceUnavailable ||
			listingProblemType(t, recorder) != hubproblem.RegionUnavailableError.Type {
			t.Fatalf("%s: status = %d body = %s", call.body, recorder.Code, recorder.Body.String())
		}
	}
}

func TestPeerOpeningSearchNeedsACertificateIdentity(t *testing.T) {
	t.Parallel()
	server := openingSearchServer()
	identified := meshidentity.WithTenant(context.Background(), "usa1")
	for _, call := range []struct {
		handler http.HandlerFunc
		body    string
	}{
		{PeerSearchOpenings(server), `{"keyword":"engineer"}`},
		{PeerSuggestOpeningOrgs(server), `{"query":"ac"}`},
	} {
		recorder := postListing(call.handler, call.body, nil, context.Background())
		if recorder.Code != http.StatusUnauthorized ||
			listingProblemType(t, recorder) != coordinatorproblem.MeshPeerAuthenticationRequiredError.Type ||
			recorder.Header().Get("WWW-Authenticate") == "" {
			t.Fatalf("%s without identity: status = %d body = %s",
				call.body, recorder.Code, recorder.Body.String())
		}
		recorder = postListing(call.handler, call.body, nil, identified)
		if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s with identity: status = %d body = %s",
				call.body, recorder.Code, recorder.Body.String())
		}
	}
	recorder := postListing(PeerSearchOpenings(server), `{"limit":0}`, nil, identified)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid peer query: status = %d", recorder.Code)
	}
}

func TestSearchPeerProblemForwardsOnlyQueryFaults(t *testing.T) {
	validation := problem.ValidationFailedError
	validation.Fields = []string{"keyword", "tag_oids.1"}
	got := searchPeerProblem(validation)
	if got.Type != problem.ValidationFailedError.Type ||
		!slices.Equal(got.Fields, []string{"query.keyword", "query.tag_oids.1"}) {
		t.Fatalf("validation problem = %+v", got)
	}
	for _, tc := range []struct {
		upstream problem.Details
		want     string
	}{
		{problem.InvalidPaginationKeyError, problem.InvalidPaginationKeyError.Type},
		{problem.ValidationFailedError, hubproblem.RegionUnavailableError.Type},
		{problem.InvalidJSONError, hubproblem.RegionUnavailableError.Type},
		{coordinatorproblem.MeshPeerAuthenticationRequiredError, hubproblem.RegionUnavailableError.Type},
		{problem.InternalServerError, hubproblem.RegionUnavailableError.Type},
		{problem.Details{Type: "unexpected-private-problem"}, hubproblem.RegionUnavailableError.Type},
	} {
		if got := searchPeerProblem(tc.upstream).Type; got != tc.want {
			t.Errorf("peer problem %q = %q, want %q", tc.upstream.Type, got, tc.want)
		}
	}
}
