package apiserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	problemspec "github.com/vetchium/src/typespec/problem"
)

func TestUnauthorized(t *testing.T) {
	runtime := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	recorder := httptest.NewRecorder()
	runtime.Unauthorized(recorder)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
	if got := recorder.Header().Get("WWW-Authenticate"); got != `Bearer realm="login"` {
		t.Fatalf("WWW-Authenticate = %q", got)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("body = %q, want empty", recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "" {
		t.Fatalf("Content-Type = %q, want empty", got)
	}
}

func TestInternalError(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewJSONHandler(&logs, nil)))
	recorder := httptest.NewRecorder()
	runtime.InternalError(context.Background(), recorder, "load test resource", errors.New("database unavailable"))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != problemspec.MediaType {
		t.Fatalf("Content-Type = %q, want %q", got, problemspec.MediaType)
	}
	var details problemspec.Details
	if err := json.NewDecoder(recorder.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	assertDetailsEqual(t, details, problemspec.InternalServerError)
	if len(details.Fields) != 0 {
		t.Fatalf("fields = %v, want none", details.Fields)
	}
	for _, want := range []string{`"level":"ERROR"`, `"event":"request_error"`, `"operation":"load test resource"`, `"error":"database unavailable"`} {
		if !bytes.Contains(logs.Bytes(), []byte(want)) {
			t.Errorf("log = %q, want %q", logs.String(), want)
		}
	}
}

func TestInternalErrorLogsEncodingFailure(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewTextHandler(&logs, nil)))
	runtime.InternalError(context.Background(), errorResponseWriter{header: make(http.Header)}, "test operation", errors.New("original error"))
	if !bytes.Contains(logs.Bytes(), []byte("encode internal error response")) {
		t.Fatalf("log = %q", logs.String())
	}
}

func TestInvalidJSON(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewJSONHandler(&logs, nil)))
	recorder := httptest.NewRecorder()
	runtime.InvalidJSON(context.Background(), recorder, errors.New("unexpected EOF"))

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != problemspec.MediaType {
		t.Fatalf("Content-Type = %q, want %q", got, problemspec.MediaType)
	}
	var details problemspec.Details
	if err := json.NewDecoder(recorder.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	assertDetailsEqual(t, details, problemspec.InvalidJSONError)
	for _, want := range []string{`"level":"WARN"`, `"event":"invalid_json"`, `"error":"unexpected EOF"`} {
		if !bytes.Contains(logs.Bytes(), []byte(want)) {
			t.Errorf("log = %q, want %q", logs.String(), want)
		}
	}
}

func TestInvalidJSONLogsEncodingFailure(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewTextHandler(&logs, nil)))
	runtime.InvalidJSON(context.Background(), errorResponseWriter{header: make(http.Header)}, errors.New("unexpected EOF"))
	if !bytes.Contains(logs.Bytes(), []byte("encode invalid JSON response")) {
		t.Fatalf("log = %q", logs.String())
	}
}

func TestValidationFailed(t *testing.T) {
	runtime := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	recorder := httptest.NewRecorder()
	runtime.ValidationFailed(context.Background(), recorder, []string{"email_address", "password"})

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != problemspec.MediaType {
		t.Fatalf("Content-Type = %q, want %q", got, problemspec.MediaType)
	}
	var details problemspec.Details
	if err := json.NewDecoder(recorder.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	expected := problemspec.ValidationFailedError
	expected.Fields = []string{"email_address", "password"}
	assertDetailsEqual(t, details, expected)
	if len(details.Fields) != 2 ||
		details.Fields[0] != "email_address" ||
		details.Fields[1] != "password" {
		t.Fatalf("fields = %v", details.Fields)
	}
}

func TestValidationFailedLogsEncodingFailure(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewTextHandler(&logs, nil)))
	runtime.ValidationFailed(context.Background(), errorResponseWriter{header: make(http.Header)}, []string{"email_address"})
	if !bytes.Contains(logs.Bytes(), []byte("encode validation failed response")) {
		t.Fatalf("log = %q", logs.String())
	}
}

func assertDetailsEqual(t *testing.T, got, want problemspec.Details) {
	t.Helper()
	if got.Type != want.Type || got.Title != want.Title ||
		got.Status != want.Status || got.Detail != want.Detail ||
		got.Instance != want.Instance {
		t.Fatalf("problem = %+v, want %+v", got, want)
	}
}

type errorResponseWriter struct {
	header http.Header
}

func (w errorResponseWriter) Header() http.Header { return w.header }
func (errorResponseWriter) WriteHeader(int)       {}
func (errorResponseWriter) Write([]byte) (int, error) {
	return 0, io.ErrClosedPipe
}
