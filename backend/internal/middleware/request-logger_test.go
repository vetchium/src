package middleware

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/problem"
)

func TestRequestLoggerRecoversWithProblemDetails(t *testing.T) {
	var logs bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logs, nil))
	handler := RequestLogger(log)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/panic", nil))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Fatalf("Content-Type = %q", got)
	}
	var details problem.Details
	if err := json.NewDecoder(recorder.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	if details.Status != http.StatusInternalServerError {
		t.Fatalf("problem = %+v", details)
	}
	logOutput := logs.String()
	for _, want := range []string{`"level":"ERROR"`, `"http.response.status_code":500`, `"stack":`} {
		if !strings.Contains(logOutput, want) {
			t.Errorf("logs missing %q: %s", want, logOutput)
		}
	}
}
