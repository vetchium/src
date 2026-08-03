package apiserver

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	problemspec "github.com/vetchium/src/typespec/problem"
)

func TestInternalError(t *testing.T) {
	runtime := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	recorder := httptest.NewRecorder()
	runtime.InternalError(recorder)

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
	if details != internalErr {
		t.Fatalf("problem = %+v, want %+v", details, internalErr)
	}
}

func TestInternalErrorLogsEncodingFailure(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewTextHandler(&logs, nil)))
	runtime.InternalError(errorResponseWriter{header: make(http.Header)})
	if !bytes.Contains(logs.Bytes(), []byte("encode internal error response")) {
		t.Fatalf("log = %q", logs.String())
	}
}

func TestMalformedJSON(t *testing.T) {
	runtime := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	recorder := httptest.NewRecorder()
	runtime.MalformedJSON(recorder)

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
	if details != malformedJSON {
		t.Fatalf("problem = %+v, want %+v", details, malformedJSON)
	}
}

func TestMalformedJSONLogsEncodingFailure(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewTextHandler(&logs, nil)))
	runtime.MalformedJSON(errorResponseWriter{header: make(http.Header)})
	if !bytes.Contains(logs.Bytes(), []byte("encode malformed JSON response")) {
		t.Fatalf("log = %q", logs.String())
	}
}

func TestInvalidRequest(t *testing.T) {
	runtime := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	recorder := httptest.NewRecorder()
	runtime.InvalidRequest(recorder, []string{"email_address", "password"})

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != problemspec.MediaType {
		t.Fatalf("Content-Type = %q, want %q", got, problemspec.MediaType)
	}
	var details problemspec.InvalidRequestDetails
	if err := json.NewDecoder(recorder.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	if details.Type != problemspec.TypeInvalidRequest ||
		details.Title != problemspec.InvalidRequestTitle ||
		details.Status != http.StatusBadRequest ||
		details.Detail != problemspec.InvalidRequestDetail ||
		len(details.InvalidFields) != 2 ||
		details.InvalidFields[0] != "email_address" ||
		details.InvalidFields[1] != "password" {
		t.Fatalf("problem = %+v", details)
	}
}

func TestInvalidRequestLogsEncodingFailure(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewTextHandler(&logs, nil)))
	runtime.InvalidRequest(errorResponseWriter{header: make(http.Header)}, []string{"email_address"})
	if !bytes.Contains(logs.Bytes(), []byte("encode invalid request response")) {
		t.Fatalf("log = %q", logs.String())
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
