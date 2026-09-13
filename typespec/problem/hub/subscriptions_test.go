package hub

import (
	"encoding/json"
	"testing"

	"github.com/vetchium/src/typespec/hub/subscriptions"
)

func TestPlanRequiredErrorEncodesExtensionMember(t *testing.T) {
	t.Parallel()
	details := PlanRequiredError(subscriptions.SilverTier)
	encoded, err := json.Marshal(details)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["type"] != "vetchium-problem-details/hub-plan-required" {
		t.Fatalf("type = %v", decoded["type"])
	}
	if decoded["title"] != "Hub plan required" {
		t.Fatalf("title = %v", decoded["title"])
	}
	if decoded["status"] != float64(403) {
		t.Fatalf("status = %v", decoded["status"])
	}
	if decoded["required_plan_oid"] != "hub-silver-tier" {
		t.Fatalf("required_plan_oid = %v", decoded["required_plan_oid"])
	}
	if got := details.ProblemDetails().Status; got != 403 {
		t.Fatalf("ProblemDetails().Status = %d, want 403", got)
	}
}
