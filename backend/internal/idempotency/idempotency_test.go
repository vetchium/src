package idempotency

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"

	"github.com/vetchium/src/typespec/common"
	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

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

// writeAPIProblem is the piece of Run that Run itself cannot expose to a unit
// test without a live database transaction.
func TestWriteAPIProblemKeepsExtensionMembers(t *testing.T) {
	runtime := apiserver.New(
		nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	request := httptest.NewRequest("POST", "/mutation", nil)
	response := httptest.NewRecorder()
	details := hubproblem.PlanRequiredError(subscriptionspec.SilverTier)

	writeAPIProblem(runtime, response, request, &APIProblem{Details: details})

	if response.Code != details.Status {
		t.Fatalf("status = %d, want %d", response.Code, details.Status)
	}
	var decoded map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["required_plan_oid"] != "hub-silver-tier" {
		t.Fatalf("body = %v, missing required_plan_oid", decoded)
	}
}
