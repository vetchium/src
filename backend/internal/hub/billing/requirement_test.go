package billing

import (
	"slices"
	"testing"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

func TestAllowedPlanOIDs(t *testing.T) {
	t.Parallel()
	if got := AllowedPlanOIDs(subscriptionspec.FreeTier); !slices.Equal(
		got, []string{"hub-free-tier", "hub-silver-tier"},
	) {
		t.Fatalf("AllowedPlanOIDs(FreeTier) = %v", got)
	}
	if got := AllowedPlanOIDs(subscriptionspec.SilverTier); !slices.Equal(
		got, []string{"hub-silver-tier"},
	) {
		t.Fatalf("AllowedPlanOIDs(SilverTier) = %v", got)
	}
}

func TestRefusalNamesTheRequiredPlan(t *testing.T) {
	t.Parallel()
	refusal := Refusal(subscriptionspec.SilverTier)
	if refusal.RequiredPlanOID != subscriptionspec.PlanOID(subscriptionspec.SilverTier) {
		t.Fatalf("RequiredPlanOID = %v", refusal.RequiredPlanOID)
	}
	if refusal.Status != 403 {
		t.Fatalf("Status = %d, want 403", refusal.Status)
	}
}
