package regions

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/problem"
	regionspec "github.com/vetchium/src/typespec/regions"

	"backend/internal/apiserver"
)

func serveOrgDiscovery(
	t *testing.T, contentType, body string,
) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(
		http.MethodPost, "/api/orgs/list-signup-regions",
		strings.NewReader(body),
	)
	request.Header.Set("Content-Type", contentType)
	response := httptest.NewRecorder()
	OrgHandler(
		apiserver.New(nil, slog.Default()), testCatalog(t, 0),
	).ServeHTTP(response, request)
	return response
}

func TestOrgDiscoveryListsCatalogRegions(t *testing.T) {
	t.Parallel()
	response := serveOrgDiscovery(t, "application/json", `{"country":"IN"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("missing cache policy")
	}
	var body regionspec.ListOrgSignupRegionsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.CatalogVersion != "3" || body.NextPaginationKey != nil {
		t.Fatalf("response = %+v", body)
	}
	tenants := []string{}
	for _, region := range body.Regions {
		tenants = append(tenants, region.TenantID)
		wantURL := "http://orgs-ui." + region.TenantID + ".localhost"
		if region.OrgsURL != wantURL ||
			region.Recommended != (region.TenantID == "ind1") {
			t.Fatalf("unexpected region %+v", region)
		}
	}
	if !slices.Equal(tenants, []string{"deu", "ind1", "sgp", "usa1"}) {
		t.Fatalf("tenants = %v", tenants)
	}
	if !strings.Contains(response.Body.String(), `"next_pagination_key":null`) {
		t.Fatalf("body = %s, want an explicit null cursor", response.Body.String())
	}
}

// A country with no recommendation of its own still gets every Org region;
// the country never filters eligibility.
func TestOrgDiscoveryUsesDefaultRecommendation(t *testing.T) {
	t.Parallel()
	response := serveOrgDiscovery(t, "application/json", `{"country":"BR"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var body regionspec.ListOrgSignupRegionsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Regions) != 4 {
		t.Fatalf("regions = %+v", body.Regions)
	}
	for _, region := range body.Regions {
		if region.Recommended != (region.TenantID == "sgp") {
			t.Fatalf("unexpected recommendation %+v", region)
		}
	}
}

func TestOrgDiscoveryRejectsBadRequests(t *testing.T) {
	t.Parallel()
	foreign := base64.RawURLEncoding.EncodeToString([]byte(
		`{"list":"orgs","country":"IN","version":"deadbeef","last":"deu"}`,
	))
	hubCursor := base64.RawURLEncoding.EncodeToString([]byte(
		`{"country":"IN","version":"deadbeef","last":"deu"}`,
	))
	for _, test := range []struct {
		name, contentType, body, problemType string
		fields                               []string
	}{
		{
			name: "malformed JSON", body: `{`,
			problemType: problem.InvalidJSONError.Type,
		},
		{
			name: "wrong content type", contentType: "text/plain",
			body: `{"country":"IN"}`, problemType: problem.InvalidJSONError.Type,
		},
		{
			name: "Hub request shape", body: `{"resident_country":"IN"}`,
			problemType: problem.InvalidJSONError.Type,
		},
		{
			name: "trailing data", body: `{"country":"IN"} {}`,
			problemType: problem.InvalidJSONError.Type,
		},
		{
			name: "missing country", body: `{}`,
			problemType: problem.ValidationFailedError.Type,
			fields:      []string{"country"},
		},
		{
			name: "unknown country", body: `{"country":"ZZ"}`,
			problemType: problem.ValidationFailedError.Type,
			fields:      []string{"country"},
		},
		{
			name:        "invalid country and cursor",
			body:        `{"country":"in","pagination_key":""}`,
			problemType: problem.ValidationFailedError.Type,
			fields:      []string{"country", "pagination_key"},
		},
		{
			name:        "malformed cursor",
			body:        `{"country":"IN","pagination_key":"bad"}`,
			problemType: problem.InvalidPaginationKeyError.Type,
		},
		{
			name:        "cursor from another catalog",
			body:        `{"country":"IN","pagination_key":"` + foreign + `"}`,
			problemType: problem.InvalidPaginationKeyError.Type,
		},
		{
			name:        "Hub cursor",
			body:        `{"country":"IN","pagination_key":"` + hubCursor + `"}`,
			problemType: problem.InvalidPaginationKeyError.Type,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			contentType := test.contentType
			if contentType == "" {
				contentType = "application/json"
			}
			response := serveOrgDiscovery(t, contentType, test.body)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s",
					response.Code, response.Body.String())
			}
			if got := response.Header().Get("Content-Type"); got != problem.MediaType {
				t.Fatalf("Content-Type = %q", got)
			}
			var body problem.Details
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Type != test.problemType ||
				!slices.Equal(body.Fields, test.fields) {
				t.Fatalf("problem = %+v, want type %s and fields %v",
					body, test.problemType, test.fields)
			}
		})
	}
}

// The declared 500 needs a JSON encoding failure, which a response built only
// from strings, booleans, and a slice cannot produce; it is left untested.
