package globalcoordinator

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	coordinatorspec "github.com/vetchium/src/typespec/global-coordinator"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	coordinatorserver "backend/internal/globalcoordinator"
)

func TestGenerateShortID(t *testing.T) {
	generator, err := coordinatorserver.OpenGenerator(
		filepath.Join(t.TempDir(), "last-id"),
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if closeErr := generator.Close(); closeErr != nil {
			t.Errorf("Close() error = %v", closeErr)
		}
	})
	server := &coordinatorserver.Server{
		Runtime:    apiserver.New(nil, slog.Default()),
		Generator:  generator,
		Credential: strings.Repeat("s", 32),
	}

	request := httptest.NewRequest(http.MethodPost, "/generate-short-id", nil)
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("s", 32))
	response := httptest.NewRecorder()
	GenerateShortID(server).ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", response.Header().Get("Cache-Control"))
	}
	var body coordinatorspec.GenerateShortIDResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !coordinatorspec.IsShortID(body.ShortID) {
		t.Fatalf("short ID = %q, want valid ID", body.ShortID)
	}
}

func TestGenerateShortIDRequiresAuthentication(t *testing.T) {
	server := &coordinatorserver.Server{
		Runtime:    apiserver.New(nil, slog.Default()),
		Credential: strings.Repeat("s", 32),
	}
	request := httptest.NewRequest(http.MethodPost, "/generate-short-id", nil)
	response := httptest.NewRecorder()
	GenerateShortID(server).ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
	if response.Header().Get("Content-Type") != problem.MediaType {
		t.Fatalf("Content-Type = %q", response.Header().Get("Content-Type"))
	}
	if response.Header().Get("WWW-Authenticate") != authenticationChallenge {
		t.Fatalf("WWW-Authenticate = %q", response.Header().Get("WWW-Authenticate"))
	}
}
