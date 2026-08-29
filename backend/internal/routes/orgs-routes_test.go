package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/orgsapi"
)

func TestOrgsPingRouteUsesPluralName(t *testing.T) {
	mux := http.NewServeMux()
	RegisterOrgsRoutes(mux, &orgsapi.Server{})

	request := httptest.NewRequest(http.MethodGet, "/api/orgs/ping", nil)
	_, pattern := mux.Handler(request)
	if pattern != "GET /api/orgs/ping" {
		t.Fatalf("plural route pattern = %q", pattern)
	}

	legacyRequest := httptest.NewRequest(http.MethodGet, "/api/org/ping", nil)
	_, legacyPattern := mux.Handler(legacyRequest)
	if legacyPattern != "" {
		t.Fatalf("legacy route pattern = %q, want no match", legacyPattern)
	}
}
