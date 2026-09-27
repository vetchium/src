package directoryclient

import (
	"context"
	"errors"
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
            "handle":"abcde000-0123456789a",
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
			Handle:     "abcde000-0123456789a", HomeTenantID: "ind1",
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

func TestOrgCommandDecodesAndValidatesResponse(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, body string
		valid      bool
	}{
		{
			name: "released domain", valid: true,
			body: `{"org_did":"018f7e32-7b5a-7d31-8fd0-f7e2a852f144",` +
				`"domain":null,"home_tenant_id":"ind1",` +
				`"routing_version":1,"state":"active"}`,
		},
		{
			name: "non-normalized domain",
			body: `{"org_did":"018f7e32-7b5a-7d31-8fd0-f7e2a852f144",` +
				`"domain":"Example.com","home_tenant_id":"ind1",` +
				`"routing_version":1,"state":"active"}`,
		},
		{
			name: "unknown field",
			body: `{"org_did":"018f7e32-7b5a-7d31-8fd0-f7e2a852f144",` +
				`"domain":null,"home_tenant_id":"ind1",` +
				`"routing_version":1,"state":"active","extra":1}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(
				func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path != "/directory/release-org-domain" {
						t.Errorf("path = %s", r.URL.Path)
					}
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(test.body))
				},
			))
			defer server.Close()
			client := New(server.URL, "/directory", "secret", time.Second)
			outcome, err := client.ReleaseOrgDomain(
				context.Background(), directoryspec.ReleaseOrgDomainRequest{},
			)
			if test.valid && (err != nil || outcome.Org == nil ||
				outcome.Org.Domain != nil) {
				t.Fatalf("outcome = %+v, err = %v", outcome, err)
			}
			if !test.valid && !errors.Is(err, ErrInvalidResponse) {
				t.Fatalf("err = %v, want invalid response", err)
			}
		})
	}
}

func TestResolveOrgDomainPreservesNotFound(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{
                "type":"vetchium-problem-details/directory-entry-not-found",
                "title":"Directory entry not found","status":404
            }`))
		},
	))
	defer server.Close()
	client := New(server.URL, "", "secret", time.Second)
	_, details, err := client.ResolveOrgDomain(
		context.Background(),
		directoryspec.ResolveOrgDomainRequest{Domain: "example.com"},
	)
	if err != nil || details == nil || details.Status != 404 {
		t.Fatalf("details = %+v, err = %v", details, err)
	}
}

func TestResolveHubAccountEmailDecodesResponse(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/directory/resolve-hub-account-email" {
				t.Errorf("path = %s", r.URL.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"home_tenant_id":"sgp"}`))
		},
	))
	defer server.Close()
	client := New(server.URL, "/directory", "secret", time.Second)
	response, details, err := client.ResolveHubAccountEmail(
		context.Background(), directoryspec.ResolveHubAccountEmailRequest{
			EmailDigest: "bee57e69a23d800d7718d0e79b2be1519e131232967431dba85e2737b6621f6e",
			DigestKeyID: "909577e87ebd5395",
		},
	)
	if err != nil || details != nil || response.HomeTenantID != "sgp" {
		t.Fatalf("response = %+v, details = %+v, err = %v", response, details, err)
	}
}

func TestReserveHubAccountEmailChangeDecodesAndValidates(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"state":"reserved"}`))
		},
	))
	defer server.Close()
	client := New(server.URL, "", "secret", time.Second)
	outcome, err := client.ReserveHubAccountEmailChange(
		context.Background(),
		directoryspec.ReserveHubAccountEmailChangeRequest{},
	)
	if err != nil || outcome.Reservation == nil ||
		outcome.Reservation.State != directoryspec.EmailChangeReserved {
		t.Fatalf("outcome = %+v, err = %v", outcome, err)
	}
}

func TestClaimHubProfessionalEmailDecodesAndValidates(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"claim_revision":3}`))
		},
	))
	defer server.Close()
	client := New(server.URL, "", "secret", time.Second)
	outcome, err := client.ClaimHubProfessionalEmail(
		context.Background(), directoryspec.ClaimHubProfessionalEmailRequest{},
	)
	if err != nil || outcome.Claim == nil || outcome.Claim.ClaimRevision != 3 {
		t.Fatalf("outcome = %+v, err = %v", outcome, err)
	}

	server2 := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"claim_revision":0}`))
		},
	))
	defer server2.Close()
	client2 := New(server2.URL, "", "secret", time.Second)
	_, err = client2.ClaimHubProfessionalEmail(
		context.Background(), directoryspec.ClaimHubProfessionalEmailRequest{},
	)
	if !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("err = %v, want invalid response for a zero revision", err)
	}
}

func TestReleaseHubProfessionalEmailDecodesResponse(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"released":true}`))
		},
	))
	defer server.Close()
	client := New(server.URL, "", "secret", time.Second)
	outcome, err := client.ReleaseHubProfessionalEmail(
		context.Background(), directoryspec.ReleaseHubProfessionalEmailRequest{},
	)
	if err != nil || outcome.Release == nil || !outcome.Release.Released {
		t.Fatalf("outcome = %+v, err = %v", outcome, err)
	}
}

func TestPullHubProfessionalEmailSupersessionsDecodesResponse(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/directory/pull-hub-professional-email-supersessions" {
				t.Errorf("path = %s", r.URL.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(
				`{"supersessions":[],"acknowledged_seq":0,"oldest_pending_created_at":null}`,
			))
		},
	))
	defer server.Close()
	client := New(server.URL, "/directory", "secret", time.Second)
	response, details, err := client.PullHubProfessionalEmailSupersessions(
		context.Background(),
		directoryspec.PullHubProfessionalEmailSupersessionsRequest{Limit: 10},
	)
	if err != nil || details != nil || len(response.Supersessions) != 0 {
		t.Fatalf("response = %+v, details = %+v, err = %v", response, details, err)
	}
}

func TestCheckHubProfessionalEmailHoldingsRejectsCountMismatch(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"results":[]}`))
		},
	))
	defer server.Close()
	client := New(server.URL, "", "secret", time.Second)
	_, _, err := client.CheckHubProfessionalEmailHoldings(
		context.Background(),
		directoryspec.CheckHubProfessionalEmailHoldingsRequest{
			Items: []directoryspec.HubProfessionalEmailHoldingQuery{
				{
					HubUserDID:  "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
					EmailDigest: "bee57e69a23d800d7718d0e79b2be1519e131232967431dba85e2737b6621f6e",
				},
			},
		},
	)
	if !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("err = %v, want invalid response for a result count mismatch", err)
	}
}
