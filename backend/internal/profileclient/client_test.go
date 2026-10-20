package profileclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/problem"
)

func TestRelayReadChecksEnvelopeAndPrivateFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/mesh/profile/read" ||
				r.Header.Get("Authorization") != "Bearer secret" {
				t.Errorf("request = %s %s", r.URL.Path,
					r.Header.Get("Authorization"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"display_name":"Ada",` +
				`"handle":"abcde000-123456789ab","resident_country":"SG",` +
				`"websites":[],"work_experiences":[],"certifications":[],` +
				`"language_abilities":[],"educational_qualifications":[]}`))
		},
	))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	outcome, err := client.RelayRead(
		context.Background(), profilespec.RelayReadProfileRequest{},
	)
	if err != nil || outcome.Profile == nil ||
		outcome.Profile.DisplayName != "Ada" ||
		outcome.Profile.WorkExperiences == nil {
		t.Fatalf("relay = %+v, %v", outcome, err)
	}
}

func TestRelayRejectsProfileWithoutWebsites(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"display_name":"Ada",` +
				`"handle":"abcde000-123456789ab","resident_country":"SG",` +
				`"work_experiences":[],"certifications":[],` +
				`"language_abilities":[],"educational_qualifications":[]}`))
		},
	))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	if _, err := client.RelayRead(
		context.Background(), profilespec.RelayReadProfileRequest{},
	); err == nil {
		t.Fatal("profile without the websites array was accepted")
	}
}

func TestRelayRejectsUndeclaredProfileFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"display_name":"Ada",` +
				`"handle":"abcde000-123456789ab","resident_country":"SG",` +
				`"hub_user_did":"private","websites":[],` +
				`"work_experiences":[],"certifications":[],` +
				`"language_abilities":[],"educational_qualifications":[]}`))
		},
	))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	if _, err := client.RelayRead(
		context.Background(), profilespec.RelayReadProfileRequest{},
	); err == nil {
		t.Fatal("private field in profile response was accepted")
	}
}

const agencyProfile = `"profile":{"display_name":"Ada",` +
	`"handle":"abcde000-123456789ab","resident_country":"SG",` +
	`"websites":[],"work_experiences":[],"certifications":[],` +
	`"language_abilities":[],"educational_qualifications":[]}`

func agencyServer(t *testing.T, body string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/mesh/agency-profile/read" ||
				r.Header.Get("Authorization") != "Bearer secret" {
				t.Errorf("request = %s %s", r.URL.Path,
					r.Header.Get("Authorization"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(body))
		},
	))
}

func TestRelayAgencyReadKeepsMonthsAndNothingElse(t *testing.T) {
	server := agencyServer(t, `{"hub_user_did":"01900000-0000-7000-8000-000000000004",`+
		agencyProfile+`,"verified_domains":[{"domain":"acme.example",`+
		`"first_verified_month":"2024-03","last_verified_month":"2025-01"}]}`)
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	outcome, err := client.RelayAgencyRead(
		context.Background(), contacts.RelayReadAgencyProfileRequest{},
	)
	if err != nil || outcome.Read == nil || len(outcome.Read.VerifiedDomains) != 1 ||
		outcome.Read.VerifiedDomains[0].LastVerifiedMonth != "2025-01" {
		t.Fatalf("agency read = %+v, %v", outcome, err)
	}
}

func TestRelayAgencyReadRejectsWhatTheContractForbids(t *testing.T) {
	did := `"hub_user_did":"01900000-0000-7000-8000-000000000004",`
	for name, body := range map[string]string{
		"an instant instead of a month": `{` + did + agencyProfile +
			`,"verified_domains":[{"domain":"acme.example",` +
			`"first_verified_month":"2024-03-01T00:00:00Z",` +
			`"last_verified_month":"2025-01"}]}`,
		"an address field": `{` + did + agencyProfile +
			`,"verified_domains":[{"domain":"acme.example",` +
			`"first_verified_month":"2024-03","last_verified_month":"2025-01",` +
			`"address":"me@acme.example"}]}`,
		"no domains array": `{` + did + agencyProfile + `}`,
		"no DID":           `{` + agencyProfile + `,"verified_domains":[]}`,
	} {
		t.Run(name, func(t *testing.T) {
			server := agencyServer(t, body)
			defer server.Close()
			client := NewRelay(server.URL, "secret", time.Second)
			if _, err := client.RelayAgencyRead(
				context.Background(), contacts.RelayReadAgencyProfileRequest{},
			); err == nil {
				t.Fatal("the response was accepted")
			}
		})
	}
}

func TestRelayAgencyReadReturnsADeclaredProblem(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", problem.MediaType)
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"type":"vetchium-problem-details/org-hub-user-not-found",` +
				`"title":"Org Hub user not found","status":404}`))
		},
	))
	defer server.Close()
	client := NewRelay(server.URL, "secret", time.Second)
	outcome, err := client.RelayAgencyRead(
		context.Background(), contacts.RelayReadAgencyProfileRequest{},
	)
	if err != nil || outcome.Problem == nil || outcome.Problem.Status != 404 {
		t.Fatalf("problem = %+v, %v", outcome, err)
	}
}
