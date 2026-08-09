package apiserver

import (
	"net/http/httptest"
	"strings"
	"testing"
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
