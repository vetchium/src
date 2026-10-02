package entitlements

import (
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

func TestOpeningQuotaFollowsThePlan(t *testing.T) {
	t.Parallel()
	for plan, want := range map[subscriptionspec.PlanOID]int{
		"org-free-tier":   25,
		"org-silver-tier": 250,
		"org-gold-tier":   2500,
		"org-platinum":    0,
		"":                0,
	} {
		if got := OpeningQuota(plan); got != want {
			t.Errorf("OpeningQuota(%q) = %d, want %d", plan, got, want)
		}
	}
}

func TestCanPublishStopsAtTheQuota(t *testing.T) {
	t.Parallel()
	free := subscriptionspec.PlanOID("org-free-tier")
	if !CanPublish(free, 24) {
		t.Error("the 25th Opening must be allowed")
	}
	if CanPublish(free, 25) {
		t.Error("the 26th Opening must be refused")
	}
	if CanPublish("org-unknown", 0) {
		t.Error("an unknown plan must publish nothing")
	}
}

func TestWindowIsTheLast365Days(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, time.FixedZone("x", 3600))
	want := time.Date(2025, 10, 3, 11, 0, 0, 0, time.UTC)
	if got := WindowStart(now); !got.Equal(want) || got.Location() != time.UTC {
		t.Fatalf("WindowStart() = %v, want %v", got, want)
	}
}
