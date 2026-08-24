package globalcoordinatorclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"backend/internal/appconfig"
)

func TestGenerateShortID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(
		w http.ResponseWriter, r *http.Request,
	) {
		if r.Method != http.MethodPost || r.URL.Path != generateShortIDPath {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-credential" {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"short_id":"0123456789a"}`))
	}))
	defer server.Close()

	client := New(server.URL, "test-credential", time.Second)
	shortID, err := client.GenerateShortID(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if shortID != "0123456789a" {
		t.Fatalf("short ID = %q", shortID)
	}
}

func TestNewFromConfig(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credential")
	credential := strings.Repeat("c", 32)
	if err := os.WriteFile(credentialPath, []byte(credential), 0o600); err != nil {
		t.Fatal(err)
	}
	client, err := NewFromConfig(appconfig.GlobalCoordinator{
		BaseURL:        "http://global-coordinator:8080",
		CredentialFile: credentialPath,
		RequestTimeout: time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if client.baseURL != "http://global-coordinator:8080" ||
		client.credential != credential {
		t.Fatalf("client = %+v", client)
	}
}

func TestGenerateShortIDRejectsInvalidResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(
		w http.ResponseWriter, _ *http.Request,
	) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"short_id":"not-valid"}`))
	}))
	defer server.Close()
	client := New(server.URL, "test-credential", time.Second)
	if _, err := client.GenerateShortID(context.Background()); err == nil {
		t.Fatal("GenerateShortID() succeeded with invalid response")
	}
}
