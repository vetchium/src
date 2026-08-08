package middleware

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/apiserver"
	"github.com/vetchium/src/typespec/problem"
)

func TestRequestLoggerRecoversWithProblemDetails(t *testing.T) {
	var logs bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logs, nil))
	panickingHandler := http.HandlerFunc(func(
		http.ResponseWriter, *http.Request,
	) {
		panic("boom")
	})
	handler := RequestLogger(apiserver.New(nil, log))(panickingHandler)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/panic", nil)
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf(
			"status = %d, want %d",
			recorder.Code, http.StatusInternalServerError,
		)
	}
	contentType := recorder.Header().Get("Content-Type")
	if contentType != "application/problem+json" {
		t.Fatalf("Content-Type = %q", contentType)
	}
	var details problem.Details
	if err := json.NewDecoder(recorder.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	if details.Status != http.StatusInternalServerError {
		t.Fatalf("problem = %+v", details)
	}
	logOutput := logs.String()
	wantedLogs := []string{
		`"level":"ERROR"`,
		`"http.response.status_code":500`,
		`"stack":`,
	}
	for _, want := range wantedLogs {
		if !strings.Contains(logOutput, want) {
			t.Errorf("logs missing %q: %s", want, logOutput)
		}
	}
}
