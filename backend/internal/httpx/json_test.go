package httpx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteProblem(t *testing.T) {
	recorder := httptest.NewRecorder()
	WriteProblem(recorder, http.StatusUnauthorized, "authentication required")

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Fatalf("Content-Type = %q, want application/problem+json", got)
	}
	if got := recorder.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	var problem Problem
	if err := json.NewDecoder(recorder.Body).Decode(&problem); err != nil {
		t.Fatal(err)
	}
	if problem.Type != "about:blank" || problem.Title != "Unauthorized" ||
		problem.Status != http.StatusUnauthorized || problem.Detail != "authentication required" {
		t.Fatalf("problem = %+v", problem)
	}
}

func TestWriteJSONUsesSafeContentType(t *testing.T) {
	recorder := httptest.NewRecorder()
	if err := WriteJSON(recorder, http.StatusOK, map[string]string{"status": "ok"}); err != nil {
		t.Fatal(err)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := recorder.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
}

func TestWriteBearerProblemIncludesChallenge(t *testing.T) {
	recorder := httptest.NewRecorder()
	WriteBearerProblem(recorder, "test-realm", "urn:test:authentication-required", "Authentication required", "authentication required")

	if got := recorder.Header().Get("WWW-Authenticate"); got != `Bearer realm="test-realm"` {
		t.Fatalf("WWW-Authenticate = %q", got)
	}
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	var problem Problem
	if err := json.NewDecoder(recorder.Body).Decode(&problem); err != nil {
		t.Fatal(err)
	}
	if problem.Type != "urn:test:authentication-required" || problem.Title != "Authentication required" {
		t.Fatalf("problem = %+v", problem)
	}
}

func TestDecodeJSONRejectsUnknownAndTrailingContent(t *testing.T) {
	tests := []string{
		`{"value":"ok","unexpected":true}`,
		`{"value":"ok"} {"value":"again"}`,
	}
	for _, body := range tests {
		t.Run(body, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
			if err := DecodeJSON(httptest.NewRecorder(), request, &struct {
				Value string `json:"value"`
			}{}); err == nil {
				t.Fatal("DecodeJSON() error = nil")
			}
		})
	}
}
