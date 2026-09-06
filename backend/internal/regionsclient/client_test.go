package regionsclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	regionspec "github.com/vetchium/src/typespec/regions"
)

func TestRegionDiscoveryClient(t *testing.T) {
	t.Parallel()
	valid := `{"catalog_version":"1","regions":[{"tenant_id":"sgp","hosting_country":"SG","hub_url":"https://hub.example.com","recommended":true}],"next_pagination_key":null}`
	for _, tt := range []struct {
		name, body, media string
		status            int
		wantError         bool
	}{
		{"valid", valid, "application/json", 200, false},
		{"unavailable", `{}`, "application/json", 503, true},
		{"wrong content type", valid, "text/plain", 200, true},
		{"trailing JSON", valid + `{}`, "application/json", 200, true},
		{"missing regions", `{"catalog_version":"1"}`, "application/json", 200, true},
		{"untrusted scheme", strings.ReplaceAll(valid, "https://hub.example.com", "javascript:alert(1)"), "application/json", 200, true},
		{"credentials in URL", strings.ReplaceAll(valid, "https://hub.example.com", "https://user@hub.example.com"), "application/json", 200, true},
		{"invalid country", strings.ReplaceAll(valid, `"SG"`, `"ZZ"`), "application/json", 200, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != MeshPath || r.Header.Get("Authorization") != "Bearer credential" {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
				}
				w.Header().Set("Content-Type", tt.media)
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer server.Close()
			client := New(server.URL, MeshPath, "credential", time.Second)
			result, err := client.ListSignupRegions(context.Background(), regionspec.ListSignupRegionsRequest{ResidentCountry: "IN"})
			if (err != nil) != tt.wantError {
				t.Fatalf("result=%+v error=%v", result, err)
			}
		})
	}
}
