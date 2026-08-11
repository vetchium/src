package idempotency

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
)

func TestKeyReturnsValidHeader(t *testing.T) {
	runtime := apiserver.New(
		nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	request := httptest.NewRequest("POST", "/mutation", nil)
	request.Header.Set("Idempotency-Key", "valid-idempotency-key-1")
	response := httptest.NewRecorder()

	key, ok := Key(runtime, response, request)
	if !ok || key != common.IdempotencyKey("valid-idempotency-key-1") {
		t.Fatalf("Key() = %q, %t", key, ok)
	}
}

func TestKeyRejectsInvalidHeader(t *testing.T) {
	runtime := apiserver.New(
		nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	request := httptest.NewRequest("POST", "/mutation", nil)
	request.Header.Set("Idempotency-Key", "short")
	response := httptest.NewRecorder()

	key, ok := Key(runtime, response, request)
	if ok || key != "" {
		t.Fatalf("Key() = %q, %t", key, ok)
	}
	if response.Code != problem.ValidationFailedError.Status {
		t.Fatalf("status = %d", response.Code)
	}
	var details problem.Details
	if err := json.Unmarshal(response.Body.Bytes(), &details); err != nil {
		t.Fatal(err)
	}
	if len(details.Fields) != 1 || details.Fields[0] != "Idempotency-Key" {
		t.Fatalf("fields = %v", details.Fields)
	}
}
