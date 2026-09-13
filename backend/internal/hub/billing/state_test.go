package billing

import (
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

func TestStateFromStoredFreePlan(t *testing.T) {
	t.Parallel()
	state, err := StateFromStored(Stored{
		HubUserDID: "u1", PlanOID: "hub-free-tier",
	})
	if err != nil {
		t.Fatal(err)
	}
	if state.Plan != subscriptionspec.FreeTier || state.HasSchedule() {
		t.Fatalf("state = %+v", state)
	}
}

func TestStateFromStoredPaidPlan(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	start := anchor
	end := date(2027, time.February, 1, 0)
	state, err := StateFromStored(Stored{
		HubUserDID: "u1", PlanOID: "hub-silver-tier", Interval: "month",
		AnchorAt: &anchor, PeriodStart: &start, PeriodEnd: &end,
	})
	if err != nil {
		t.Fatal(err)
	}
	if state.Plan != subscriptionspec.SilverTier ||
		state.Interval != subscriptionspec.Month ||
		!state.AnchorAt.Equal(anchor) || !state.PeriodStart.Equal(start) ||
		!state.PeriodEnd.Equal(end) {
		t.Fatalf("state = %+v", state)
	}
}

func TestStateFromStoredWithScheduledChange(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	start := anchor
	end := date(2027, time.February, 1, 0)
	state, err := StateFromStored(Stored{
		HubUserDID: "u1", PlanOID: "hub-silver-tier", Interval: "month",
		AnchorAt: &anchor, PeriodStart: &start, PeriodEnd: &end,
		ScheduledPlanOID: "hub-free-tier",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !state.HasSchedule() || state.ScheduledPlan != subscriptionspec.FreeTier ||
		state.ScheduledInterval != "" {
		t.Fatalf("state = %+v", state)
	}
}

func TestStateFromStoredRejectsUnknownPlan(t *testing.T) {
	t.Parallel()
	if _, err := StateFromStored(Stored{
		HubUserDID: "u1", PlanOID: "hub-gold-tier",
	}); err == nil {
		t.Fatal("expected an error for an unknown plan")
	}
}

func TestStateFromStoredRejectsUnknownScheduledPlan(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	if _, err := StateFromStored(Stored{
		HubUserDID: "u1", PlanOID: "hub-silver-tier", Interval: "month",
		AnchorAt: &anchor, PeriodStart: &anchor, PeriodEnd: &end,
		ScheduledPlanOID: "hub-gold-tier",
	}); err == nil {
		t.Fatal("expected an error for an unknown scheduled plan")
	}
}

func TestStateFromStoredRejectsInconsistentPeriod(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	start := date(2027, time.January, 15, 0)
	end := date(2027, time.February, 1, 0)
	if _, err := StateFromStored(Stored{
		HubUserDID: "u1", PlanOID: "hub-silver-tier", Interval: "month",
		AnchorAt: &anchor, PeriodStart: &start, PeriodEnd: &end,
	}); err == nil {
		t.Fatal("expected an error for a period not on an anchor boundary")
	}
}

func TestStateFromStoredRejectsPaidPlanMissingPeriod(t *testing.T) {
	t.Parallel()
	if _, err := StateFromStored(Stored{
		HubUserDID: "u1", PlanOID: "hub-silver-tier", Interval: "month",
	}); err == nil {
		t.Fatal("expected an error for a paid plan with no period")
	}
}
