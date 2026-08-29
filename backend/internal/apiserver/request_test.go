package apiserver

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	problemspec "github.com/vetchium/src/typespec/problem"
)

func TestDecodeJSON(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		body        string
		wantValue   string
		wantError   string
	}{
		{
			name: "JSON", contentType: "application/json",
			body: `{"value":"ok"}`, wantValue: "ok",
		},
		{
			name:        "JSON with parameters",
			contentType: "application/json; charset=utf-8",
			body:        `{"value":"ok"}`, wantValue: "ok",
		},
		{
			name: "missing content type", body: `{"value":"ok"}`,
			wantError: "Content-Type must be application/json",
		},
		{
			name: "unknown field", contentType: "application/json",
			body:      `{"value":"ok","extra":true}`,
			wantError: `json: unknown field "extra"`,
		},
		{
			name: "trailing JSON value", contentType: "application/json",
			body:      `{"value":"ok"} {}`,
			wantError: "multiple JSON values",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(
				"POST", "/", strings.NewReader(tt.body),
			)
			if tt.contentType != "" {
				request.Header.Set("Content-Type", tt.contentType)
			}
			var destination struct {
				Value string `json:"value"`
			}
			err := DecodeJSON(request, &destination)
			if tt.wantError == "" {
				if err != nil {
					t.Fatalf("DecodeJSON() error = %v", err)
				}
				if destination.Value != tt.wantValue {
					t.Fatalf(
						"decoded value = %q, want %q",
						destination.Value, tt.wantValue,
					)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantError) {
				t.Fatalf(
					"DecodeJSON() error = %v, want error containing %q",
					err, tt.wantError,
				)
			}
		})
	}
}

func TestDecodeJSONDoesNotLimitBodySize(t *testing.T) {
	value := strings.Repeat("x", (1<<20)+1)
	request := httptest.NewRequest(
		"POST", "/", strings.NewReader(`{"value":"`+value+`"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	var destination struct {
		Value string `json:"value"`
	}
	if err := DecodeJSON(request, &destination); err != nil {
		t.Fatalf("DecodeJSON() error = %v", err)
	}
	if destination.Value != value {
		t.Fatalf(
			"decoded value length = %d, want %d",
			len(destination.Value), len(value),
		)
	}
}

// failingWriter accepts the header but rejects the body, which is what a
// client disconnecting mid-response looks like to a handler.
type failingWriter struct {
	header http.Header
	status int
	writes int
}

func (w *failingWriter) Header() http.Header {
	if w.header == nil {
		w.header = http.Header{}
	}
	return w.header
}

func (w *failingWriter) Write([]byte) (int, error) {
	w.writes++
	return 0, errors.New("connection reset")
}

func (w *failingWriter) WriteHeader(status int) {
	if w.status != 0 {
		panic("superfluous WriteHeader call")
	}
	w.status = status
}

func TestJSONDoesNotReplaceAPartiallyWrittenResponse(t *testing.T) {
	var logged bytes.Buffer
	runtime := New(nil, slog.New(slog.NewTextHandler(&logged, nil)))
	writer := &failingWriter{}

	runtime.JSON(t.Context(), writer, http.StatusOK, map[string]string{
		"value": "ok",
	})

	if writer.status != http.StatusOK {
		t.Fatalf("status = %d, want %d", writer.status, http.StatusOK)
	}
	if writer.writes != 1 {
		t.Fatalf("write attempts = %d, want 1", writer.writes)
	}
	if !strings.Contains(logged.String(), "write JSON response") {
		t.Fatalf("log = %s", logged.String())
	}
}

func TestJSONReportsAnUnencodableValue(t *testing.T) {
	var logged bytes.Buffer
	runtime := New(nil, slog.New(slog.NewTextHandler(&logged, nil)))
	response := httptest.NewRecorder()

	runtime.JSON(t.Context(), response, http.StatusOK, make(chan int))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", response.Code)
	}
	if got := response.Header().Get("Content-Type"); got != problemspec.MediaType {
		t.Fatalf("Content-Type = %q, want %q", got, problemspec.MediaType)
	}
}
