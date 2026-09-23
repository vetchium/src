package profileclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	profilespec "github.com/vetchium/src/typespec/hub/profile"
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
				`"handle":"abcde-123456789ab","resident_country":"SG",` +
				`"work_experiences":[],"certifications":[],` +
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

func TestRelayRejectsUndeclaredProfileFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"display_name":"Ada",` +
				`"handle":"abcde-123456789ab","resident_country":"SG",` +
				`"hub_user_did":"private","work_experiences":[],` +
				`"certifications":[],"language_abilities":[],` +
				`"educational_qualifications":[]}`))
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
