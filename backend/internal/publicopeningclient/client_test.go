package publicopeningclient

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/orgs"
)

func TestRelayListChecksEnvelopeAndRejectsPrivateFields(t *testing.T) {
	var response atomic.Value
	response.Store(`{"org":{"domain":"example.com","display_name":"Example"},` +
		`"openings":[]}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/mesh/org-openings/list" ||
			r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("request = %s %s", r.URL.Path, r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response.Load().(string)))
	}))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	request := openingsspec.ListOrgOpeningsRequest{Domain: orgs.OrgDomain("example.com")}
	outcome, err := client.RelayList(context.Background(), request)
	if err != nil || outcome.Result == nil || outcome.Result.Openings == nil {
		t.Fatalf("list = %+v, %v", outcome, err)
	}
	response.Store(`{"org":{"domain":"example.com","display_name":"Example"},` +
		`"openings":[],"internal_notes":"private"}`)
	if _, err := client.RelayList(context.Background(), request); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("private field error = %v", err)
	}
}

func TestRelayGetRejectsPrivateOpeningFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"org":{"domain":"example.com",` +
			`"display_name":"Example"},"opening":{"opening_number":1,` +
			`"state":"not_accepting","title":"Role","version":4}}`))
	}))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	_, err := client.RelayGet(context.Background(), openingsspec.GetOrgOpeningRequest{
		Domain: orgs.OrgDomain("example.com"), OpeningNumber: 1,
	})
	if !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("private field error = %v", err)
	}
}

func TestRelayListBoundsResponseAndRejectsRedirect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/mesh/org-openings/list" {
			w.Header().Set("Location", "/another")
			w.WriteHeader(http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(strings.Repeat("x", maxResponseBytes+1)))
	}))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	request := openingsspec.ListOrgOpeningsRequest{Domain: orgs.OrgDomain("example.com")}
	if _, err := client.RelayList(context.Background(), request); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("redirect error = %v", err)
	}
}

func TestRelayListRejectsOversizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(strings.Repeat("x", maxResponseBytes+1)))
	}))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	request := openingsspec.ListOrgOpeningsRequest{Domain: orgs.OrgDomain("example.com")}
	if _, err := client.RelayList(context.Background(), request); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("oversized response error = %v", err)
	}
}

func TestPeerRejectsInvalidTenantConfiguration(t *testing.T) {
	client := NewPeer(nil, time.Second)
	_, err := client.PeerList(context.Background(), "bad tenant",
		openingsspec.ListOrgOpeningsRequest{})
	if !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("peer configuration error = %v", err)
	}
}
