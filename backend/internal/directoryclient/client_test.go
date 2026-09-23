package directoryclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
)

func TestCommandUsesBearerCredentialAndDecodesSuccess(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/directory/reserve-hub-principal" ||
			r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("request = %s, authorization = %q", r.URL.Path, r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
            "hub_user_did":"018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
            "handle":"abcde-0123456789a",
            "profile_alias":null,
            "home_tenant_id":"ind1",
            "routing_version":1,
            "state":"provisioning"
        }`))
	}))
	defer server.Close()

	client := New(server.URL, "/directory", "secret", time.Second)
	outcome, err := client.ReserveHubPrincipal(
		context.Background(), directoryspec.ReserveHubPrincipalRequest{
			CommandID:  "4569b853-4778-4e67-a635-5f41b06585f5",
			HubUserDID: "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
			Handle:     "abcde-0123456789a", HomeTenantID: "ind1",
			ProvisioningExpiresAt: time.Now().Add(time.Hour),
		},
	)
	if err != nil || outcome.Principal == nil ||
		outcome.Principal.State != directoryspec.PrincipalProvisioning {
		t.Fatalf("outcome = %+v, err = %v", outcome, err)
	}
}

func TestCommandPreservesProblemDetails(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{
            "type":"vetchium-problem-details/directory-claim-conflict",
            "title":"Directory claim conflict",
            "status":409
        }`))
	}))
	defer server.Close()

	client := New(server.URL, "", "secret", time.Second)
	outcome, err := client.SetHubAlias(
		context.Background(), directoryspec.SetHubAliasRequest{
			CommandID:  "4569b853-4778-4e67-a635-5f41b06585f5",
			HubUserDID: hub.HubUserDID("018f7e32-7b5a-7d31-8fd0-f7e2a852f144"),
		},
	)
	if err != nil || outcome.Problem == nil || outcome.Problem.Status != 409 {
		t.Fatalf("outcome = %+v, err = %v", outcome, err)
	}
}

func TestCommandRejectsOversizedResponse(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(make([]byte, maxResponseBytes+1))
	}))
	defer server.Close()
	client := New(server.URL, "", "", time.Second)
	_, err := client.ActivateHubPrincipal(
		context.Background(), directoryspec.ActivateHubPrincipalRequest{},
	)
	if err == nil {
		t.Fatal("ActivateHubPrincipal() error = nil, want oversized response error")
	}
}
