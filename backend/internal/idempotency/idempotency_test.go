package idempotency

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
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

func TestAcceptedIdempotentResponseCanCarryBody(t *testing.T) {
	runtime := apiserver.New(
		nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	request := httptest.NewRequest("POST", "/mutation", nil)
	empty := httptest.NewRecorder()
	writeResponse(runtime, empty, request, http.StatusAccepted, struct{}{})
	if empty.Code != http.StatusAccepted || empty.Body.Len() != 0 {
		t.Fatalf("empty 202 = %d %q", empty.Code, empty.Body.String())
	}
	withBody := httptest.NewRecorder()
	writeResponse(runtime, withBody, request, http.StatusAccepted,
		struct {
			ChallengeID string `json:"challenge_id"`
		}{
			ChallengeID: "example",
		})
	if withBody.Code != http.StatusAccepted ||
		withBody.Header().Get("Content-Type") != "application/json" ||
		withBody.Body.String() != `{"challenge_id":"example"}` {
		t.Fatalf("202 with body = %d %q", withBody.Code,
			withBody.Body.String())
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

func TestCommittedProblemReplayKeepsExtensionsAndMediaType(t *testing.T) {
	runtime := apiserver.New(
		nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	request := httptest.NewRequest("POST", "/mutation", nil)
	response := httptest.NewRecorder()
	original := hubproblem.PlanRequiredError(subscriptionspec.SilverTier)
	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	writeAPIProblem(runtime, response, request, &APIProblem{
		Details: replayProblem{Details: original.Details, raw: raw},
	})
	if response.Code != original.Status ||
		response.Header().Get("Content-Type") != problem.MediaType {
		t.Fatalf("replayed status/content type = %d/%q",
			response.Code, response.Header().Get("Content-Type"))
	}
	var decoded map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["required_plan_oid"] != string(subscriptionspec.SilverTier) {
		t.Fatalf("extension lost on replay: %v", decoded)
	}
}
