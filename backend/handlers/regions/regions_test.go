package regions

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	regionspec "github.com/vetchium/src/typespec/regions"

	"backend/internal/apiserver"
	regionpolicy "backend/internal/regions"
)

func testCatalog(t *testing.T, _ int) *regionpolicy.Catalog {
	t.Helper()
	c, err := regionpolicy.Load("../../../config/signup-regions.json")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

type unavailableDirectory struct{}

func (unavailableDirectory) ListSignupRegions(context.Context, regionspec.ListSignupRegionsRequest) (regionspec.ListSignupRegionsResponse, error) {
	return regionspec.ListSignupRegionsResponse{}, fmt.Errorf("offline")
}
func TestDiscoveryHTTP(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, body, auth, credential string
		status                       int
		offline                      bool
	}{
		{name: "public", body: `{"resident_country":"IND"}`, status: 200},
		{name: "global outage", body: `{"resident_country":"IND"}`, status: 200, offline: true},
		{name: "mesh authorized", body: `{"resident_country":"IND"}`, auth: "Bearer secret", credential: "secret", status: 200},
		{name: "missing auth", body: `{"resident_country":"IND"}`, credential: "secret", status: 401},
		{name: "wrong auth", body: `{"resident_country":"IND"}`, credential: "secret", auth: "Bearer wrong", status: 401},
		{name: "invalid JSON", body: `{`, status: 400},
		{name: "unknown field", body: `{"resident_country":"IND","tenant":"sgp"}`, status: 400},
		{name: "invalid country", body: `{"resident_country":"ZZZ"}`, status: 400},
		{name: "invalid cursor", body: `{"resident_country":"IND","pagination_key":"bad"}`, status: 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			var directory regionpolicy.Directory
			if test.offline {
				directory = unavailableDirectory{}
			}
			request := httptest.NewRequest(http.MethodPost, "/list-signup-regions", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Authorization", test.auth)
			response := httptest.NewRecorder()
			Handler(apiserver.New(nil, slog.Default()), testCatalog(t, 2), directory, test.credential).ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status=%d, body=%s", response.Code, response.Body.String())
			}
			if test.status == 200 && response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing cache policy")
			}
			if test.status == 401 && response.Header().Get("WWW-Authenticate") == "" {
				t.Fatal("missing auth challenge")
			}
		})
	}
}
