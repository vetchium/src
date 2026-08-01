package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/server"
)

func TestPortalRouteIsolation(t *testing.T) {
	tests := []struct {
		name       string
		register   func(*http.ServeMux, *server.Server)
		allowed    []string
		prohibited []string
	}{
		{
			name:       "admin",
			register:   RegisterAdminRoutes,
			allowed:    []string{"/api/admin/ping"},
			prohibited: []string{"/api/hub/ping", "/api/org/ping", "/api/orgs"},
		},
		{
			name:       "hub",
			register:   RegisterHubRoutes,
			allowed:    []string{"/api/hub/ping"},
			prohibited: []string{"/api/admin/ping", "/api/org/ping", "/api/orgs"},
		},
		{
			name:       "orgs",
			register:   RegisterOrgsRoutes,
			allowed:    []string{"/api/org/ping", "/api/orgs"},
			prohibited: []string{"/api/admin/ping", "/api/hub/ping"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mux := http.NewServeMux()
			test.register(mux, &server.Server{})

			for _, path := range test.allowed {
				assertRouteRegistered(t, mux, path, true)
			}
			for _, path := range test.prohibited {
				assertRouteRegistered(t, mux, path, false)
			}
		})
	}
}

func assertRouteRegistered(t *testing.T, mux *http.ServeMux, path string, want bool) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	_, pattern := mux.Handler(request)
	if got := pattern != ""; got != want {
		t.Fatalf("route %q registered = %t, want %t", path, got, want)
	}
}
