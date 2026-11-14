package publicopeningclient

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/problem"
)

const searchOrg = `{"domain":"example.com","display_name":"Example","country":"SG"}`

func searchItem(org, opening string) string {
	return `{"org":` + org + `,"opening":` + opening + `}`
}

func searchOpening(number int, extra string) string {
	return fmt.Sprintf(`{"opening_number":%d,"title":"Engineer",`+
		`"employing_country":"SG","work_arrangement":"hybrid",`+
		`"employment_type":"full_time",`+
		`"first_published_at":"2026-10-10T01:00:00Z","tags":[]%s}`, number, extra)
}

func TestPeerSearchEndpointNamesTheTenantServer(t *testing.T) {
	client := NewPeer(&tls.Config{MinVersion: tls.VersionTLS13}, time.Second)
	for path, want := range map[string]string{
		"opening-search/search":       "https://usa1.mesh.vetchium.com:8443/api/mesh/opening-search/search",
		"opening-search/suggest-orgs": "https://usa1.mesh.vetchium.com:8443/api/mesh/opening-search/suggest-orgs",
	} {
		endpoint, tlsConfig, err := client.peerEndpoint("usa1", path)
		if err != nil || endpoint != want || tlsConfig.ServerName != "usa1.mesh.vetchium.com" {
			t.Fatalf("%s: endpoint %q, server name %q, %v", path, endpoint, tlsConfig.ServerName, err)
		}
	}
	if client.baseTLS.ServerName != "" {
		t.Fatal("peer endpoint changed the shared TLS configuration")
	}
	if _, err := NewPeer(nil, time.Second).PeerSearch(context.Background(), "usa1",
		openingsspec.OpeningSearchQuery{}); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("peer without TLS error = %v", err)
	}
}

func TestRelaySearchSendsOnlyTheQueryAndValidatesTheResponse(t *testing.T) {
	var response atomic.Value
	var sent atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if r.URL.Path != "/mesh/opening-search/search" ||
			r.Header.Get("Authorization") != "Bearer secret" ||
			json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Errorf("request = %s %s", r.URL.Path, r.Header.Get("Authorization"))
		}
		keys := []string{}
		for key := range body {
			keys = append(keys, key)
		}
		sent.Store(strings.Join(keys, ","))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response.Load().(string)))
	}))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	limit := openingsspec.OpeningSearchPageSize(1)
	domain := orgs.OrgDomain("example.com")
	query := openingsspec.OpeningSearchQuery{Limit: &limit, OrgDomain: &domain}

	response.Store(`{"openings":[` + searchItem(searchOrg, searchOpening(1,
		`,"salary":{"currency":"SGD","min":1,"max":2,"period":"month"}`)) +
		`],"next_pagination_key":"abc"}`)
	outcome, err := client.RelaySearch(context.Background(), "usa1", query)
	if err != nil || outcome.Result == nil || len(outcome.Result.Openings) != 1 ||
		outcome.Result.Openings[0].Opening.Salary == nil {
		t.Fatalf("search = %+v, %v", outcome, err)
	}
	if keys := sent.Load().(string); keys != "tenant_id,query" && keys != "query,tenant_id" {
		t.Fatalf("relay request members = %s", keys)
	}

	otherOrg := strings.Replace(searchOrg, "example.com", "other.example", 1)
	for name, body := range map[string]string{
		"null list":       `{"openings":null}`,
		"over the limit":  `{"openings":[` + searchItem(searchOrg, searchOpening(2, "")) + `,` + searchItem(searchOrg, searchOpening(1, "")) + `]}`,
		"other Org":       `{"openings":[` + searchItem(otherOrg, searchOpening(1, "")) + `]}`,
		"bad Org":         `{"openings":[` + searchItem(`{"domain":"x","display_name":"X","country":"SG"}`, searchOpening(1, "")) + `]}`,
		"missing tags":    `{"openings":[` + searchItem(searchOrg, strings.Replace(searchOpening(1, ""), `,"tags":[]`, "", 1)) + `]}`,
		"bad number":      `{"openings":[` + searchItem(searchOrg, searchOpening(0, "")) + `]}`,
		"private field":   `{"openings":[` + searchItem(searchOrg, searchOpening(1, `,"internal_notes":"x"`)) + `]}`,
		"private Org":     `{"openings":[` + searchItem(strings.Replace(searchOrg, "}", `,"org_did":"x"}`, 1), searchOpening(1, "")) + `]}`,
		"bad salary":      `{"openings":[` + searchItem(searchOrg, searchOpening(1, `,"salary":{"currency":"??","min":1,"max":2,"period":"month"}`)) + `]}`,
		"bad pagination":  `{"openings":[],"next_pagination_key":""}`,
		"extra top level": `{"openings":[],"viewer":"x"}`,
	} {
		response.Store(body)
		if _, err := client.RelaySearch(context.Background(), "usa1", query); !errors.Is(err, ErrInvalidResponse) {
			t.Fatalf("%s: error = %v", name, err)
		}
	}
}

func TestRelaySuggestOrgsBoundsTheList(t *testing.T) {
	var response atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/mesh/opening-search/suggest-orgs" {
			t.Errorf("path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response.Load().(string)))
	}))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	query := openingsspec.SuggestOpeningOrgsQuery{Query: "ex"}
	list := func(n int) string {
		orgs := make([]string, n)
		for i := range orgs {
			orgs[i] = searchOrg
		}
		return `{"orgs":[` + strings.Join(orgs, ",") + `]}`
	}
	response.Store(list(openingsspec.MaxOpeningOrgSuggestions))
	outcome, err := client.RelaySuggestOrgs(context.Background(), "usa1", query)
	if err != nil || outcome.Result == nil ||
		len(outcome.Result.Orgs) != openingsspec.MaxOpeningOrgSuggestions {
		t.Fatalf("suggestions = %+v, %v", outcome, err)
	}
	for name, body := range map[string]string{
		"too many":  list(openingsspec.MaxOpeningOrgSuggestions + 1),
		"null list": `{"orgs":null}`,
		"bad Org":   `{"orgs":[{"domain":"example.com","display_name":"","country":"SG"}]}`,
	} {
		response.Store(body)
		if _, err := client.RelaySuggestOrgs(context.Background(), "usa1", query); !errors.Is(err, ErrInvalidResponse) {
			t.Fatalf("%s: error = %v", name, err)
		}
	}
}

func TestRelaySearchPassesProblemsThrough(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", problem.MediaType)
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(problem.InvalidPaginationKeyError)
	}))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	outcome, err := client.RelaySearch(context.Background(), "usa1", openingsspec.OpeningSearchQuery{})
	if err != nil || outcome.Result != nil || outcome.Problem == nil ||
		outcome.Problem.Type != problem.InvalidPaginationKeyError.Type {
		t.Fatalf("search problem = %+v, %v", outcome, err)
	}
	suggest, err := client.RelaySuggestOrgs(context.Background(), "usa1",
		openingsspec.SuggestOpeningOrgsQuery{Query: "ex"})
	if err != nil || suggest.Problem == nil {
		t.Fatalf("suggest problem = %+v, %v", suggest, err)
	}
}
