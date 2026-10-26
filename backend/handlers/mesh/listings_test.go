package mesh

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/listingclient"
	"backend/internal/listings"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
)

type listingQueries struct {
	searchRows []sqlc.SearchPublicListingsRow
	getErr     error
	getRow     sqlc.GetPublicListingRow

	engagementRow sqlc.GetEngagementListingForConsumerRow
	engagementErr error
}

func (q listingQueries) SearchPublicListings(
	context.Context, sqlc.SearchPublicListingsParams,
) ([]sqlc.SearchPublicListingsRow, error) {
	return q.searchRows, nil
}

func (q listingQueries) GetEngagementListingForConsumer(
	context.Context, sqlc.GetEngagementListingForConsumerParams,
) (sqlc.GetEngagementListingForConsumerRow, error) {
	return q.engagementRow, q.engagementErr
}

func (q listingQueries) GetPublicListing(
	context.Context, sqlc.GetPublicListingParams,
) (sqlc.GetPublicListingRow, error) {
	return q.getRow, q.getErr
}

func listingServer(queries listingQueries) *meshapi.Server {
	return &meshapi.Server{
		Runtime:        apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		TenantID:       "sgp",
		Credential:     "relay-secret",
		PublicListings: listings.Reader{Queries: queries},
		// A peer client without TLS cannot reach any tenant.
		ListingPeers: listingclient.NewPeer(nil, time.Second),
	}
}

func postListing(
	handler http.HandlerFunc, body string, headers map[string]string,
	ctx context.Context,
) *httptest.ResponseRecorder {
	request := httptest.NewRequestWithContext(ctx, http.MethodPost, "/", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	handler(recorder, request)
	return recorder
}

var relayAuth = map[string]string{"Authorization": "Bearer relay-secret"}

func listingProblemType(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var details problem.Details
	if err := json.Unmarshal(recorder.Body.Bytes(), &details); err != nil {
		t.Fatalf("problem body %q: %v", recorder.Body.String(), err)
	}
	return details.Type
}

const searchBody = `{"tenant":"%s","search":{"capability":"sourcing","limit":5}}`

func searchRequest(tenant string) string {
	return strings.Replace(searchBody, "%s", tenant, 1)
}

func TestRelaySearchListingsRequiresTheRelayCredential(t *testing.T) {
	t.Parallel()
	handler := RelaySearchListings(listingServer(listingQueries{}))
	for _, headers := range []map[string]string{nil, {"Authorization": "Bearer wrong"}} {
		recorder := postListing(handler, searchRequest("sgp"), headers, context.Background())
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d", recorder.Code)
		}
	}
}

func TestRelaySearchListingsValidatesTheRequest(t *testing.T) {
	t.Parallel()
	handler := RelaySearchListings(listingServer(listingQueries{}))
	for _, body := range []string{
		`{"tenant":"sgp","search":{"capability":"sourcing","limit":0}}`,
		`{"tenant":"Bad","search":{"capability":"sourcing","limit":5}}`,
	} {
		if recorder := postListing(handler, body, relayAuth, context.Background()); recorder.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d", body, recorder.Code)
		}
	}
	if recorder := postListing(handler, `{`, relayAuth, context.Background()); recorder.Code != http.StatusBadRequest {
		t.Fatalf("malformed JSON status = %d", recorder.Code)
	}
}

func TestRelaySearchListingsAnswersItsOwnTenantLocally(t *testing.T) {
	t.Parallel()
	queries := listingQueries{searchRows: []sqlc.SearchPublicListingsRow{{
		CapabilityOid: "sourcing", Headline: "H", ServiceWorldwide: true,
		Domain: "acme.test", DisplayName: "Acme", Country: "SG", SortName: "acme",
	}}}
	recorder := postListing(RelaySearchListings(listingServer(queries)),
		searchRequest("sgp"), relayAuth, context.Background())
	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status = %d headers = %v", recorder.Code, recorder.Header())
	}
	var response marketplace.PeerSearchListingsResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil ||
		len(response.Listings) != 1 || response.Listings[0].SortName != "acme" {
		t.Fatalf("body = %s, %v", recorder.Body.String(), err)
	}
}

func TestRelaySearchListingsNamesAnUnreachableTenantUnavailable(t *testing.T) {
	t.Parallel()
	recorder := postListing(RelaySearchListings(listingServer(listingQueries{})),
		searchRequest("usa1"), relayAuth, context.Background())
	if recorder.Code != http.StatusServiceUnavailable ||
		listingProblemType(t, recorder) != orgsproblem.TenantUnavailableError.Type {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestRelayGetListing(t *testing.T) {
	t.Parallel()
	const body = `{"tenant":"%s","listing":{"domain":"acme.test","capability":"sourcing"}}`
	request := func(tenant string) string { return strings.Replace(body, "%s", tenant, 1) }
	found := listingQueries{getRow: sqlc.GetPublicListingRow{
		CapabilityOid: "sourcing", Headline: "H", Description: "D",
		Domain: "acme.test", DisplayName: "Acme", Country: "SG",
	}}
	if recorder := postListing(RelayGetListing(listingServer(found)), request("sgp"), relayAuth, context.Background()); recorder.Code != http.StatusOK ||
		recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("found: status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	missing := listingQueries{getErr: pgx.ErrNoRows}
	recorder := postListing(RelayGetListing(listingServer(missing)), request("sgp"), relayAuth, context.Background())
	if recorder.Code != http.StatusNotFound || listingProblemType(t, recorder) != orgsproblem.ListingNotFoundError.Type {
		t.Fatalf("missing: status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	recorder = postListing(RelayGetListing(listingServer(found)), request("usa1"), relayAuth, context.Background())
	if recorder.Code != http.StatusServiceUnavailable ||
		listingProblemType(t, recorder) != orgsproblem.TenantUnavailableError.Type {
		t.Fatalf("unreachable: status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder := postListing(RelayGetListing(listingServer(found)), request("sgp"), nil, context.Background()); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", recorder.Code)
	}
}

func TestPeerListingReadsNeedACertificateIdentity(t *testing.T) {
	t.Parallel()
	server := listingServer(listingQueries{getRow: sqlc.GetPublicListingRow{
		CapabilityOid: "sourcing", Headline: "H", Description: "D",
		Domain: "acme.test", DisplayName: "Acme", Country: "SG",
	}})
	search := `{"capability":"sourcing","limit":5}`
	get := `{"domain":"acme.test","capability":"sourcing"}`
	identified := meshidentity.WithTenant(context.Background(), "usa1")
	for _, call := range []struct {
		handler http.HandlerFunc
		body    string
	}{
		{PeerSearchListings(server), search}, {PeerGetListing(server), get},
	} {
		recorder := postListing(call.handler, call.body, nil, context.Background())
		if recorder.Code != http.StatusUnauthorized ||
			listingProblemType(t, recorder) != coordinatorproblem.MeshPeerAuthenticationRequiredError.Type ||
			recorder.Header().Get("WWW-Authenticate") == "" {
			t.Fatalf("%s without a certificate identity: status = %d body = %s",
				call.body, recorder.Code, recorder.Body.String())
		}
	}
	if recorder := postListing(PeerSearchListings(server), search, nil, identified); recorder.Code != http.StatusOK {
		t.Fatalf("peer search status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder := postListing(PeerGetListing(server), get, nil, identified); recorder.Code != http.StatusOK {
		t.Fatalf("peer get status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder := postListing(PeerSearchListings(server), `{"capability":"sourcing","limit":99}`, nil, identified); recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid peer search status = %d", recorder.Code)
	}
	missing := listingServer(listingQueries{getErr: pgx.ErrNoRows})
	recorder := postListing(PeerGetListing(missing), get, nil, identified)
	if recorder.Code != http.StatusNotFound || listingProblemType(t, recorder) != orgsproblem.ListingNotFoundError.Type {
		t.Fatalf("missing peer Listing: status = %d", recorder.Code)
	}
}

const engagementListingBody = `{"engagement_id":"01900000-0000-7000-8000-000000000003",` +
	`"consumer_org_did":"01900000-0000-7000-8000-000000000001"}`

func TestRelayEngagementListing(t *testing.T) {
	t.Parallel()
	found := listingQueries{engagementRow: sqlc.GetEngagementListingForConsumerRow{
		CapabilityOid: "sourcing",
	}}
	body := func(tenant string) string {
		return `{"tenant":"` + tenant + `","request":` + engagementListingBody + `}`
	}
	recorder := postListing(RelayEngagementListing(listingServer(found)), body("sgp"), relayAuth, context.Background())
	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("found: status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	missing := listingQueries{engagementErr: pgx.ErrNoRows}
	recorder = postListing(RelayEngagementListing(listingServer(missing)), body("sgp"), relayAuth, context.Background())
	if recorder.Code != http.StatusNotFound || listingProblemType(t, recorder) != orgsproblem.EngagementNotFoundError.Type {
		t.Fatalf("missing: status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	recorder = postListing(RelayEngagementListing(listingServer(found)), body("usa1"), relayAuth, context.Background())
	if recorder.Code != http.StatusServiceUnavailable ||
		listingProblemType(t, recorder) != orgsproblem.TenantUnavailableError.Type {
		t.Fatalf("unreachable: status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder := postListing(RelayEngagementListing(listingServer(found)), body("sgp"), nil, context.Background()); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", recorder.Code)
	}
	if recorder := postListing(RelayEngagementListing(listingServer(found)), `{"tenant":"sgp","request":{}}`, relayAuth, context.Background()); recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid status = %d", recorder.Code)
	}
}

func TestPeerEngagementListingNeedsACertificateIdentity(t *testing.T) {
	t.Parallel()
	server := listingServer(listingQueries{})
	recorder := postListing(PeerEngagementListing(server), engagementListingBody, nil, context.Background())
	if recorder.Code != http.StatusUnauthorized ||
		listingProblemType(t, recorder) != coordinatorproblem.MeshPeerAuthenticationRequiredError.Type {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
}
