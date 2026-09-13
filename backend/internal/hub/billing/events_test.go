package billing

import (
	"encoding/json"
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

func TestSystemTransitionEventsChainsSnapshots(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	before := paidState(anchor, anchor, end, subscriptionspec.Month)
	_, transitions := Advance(before, end)
	events := SystemTransitionEvents(
		"did-1", before, transitions, Actor{Type: "worker", ID: "subscription-renewal"},
	)
	if len(events) != 1 {
		t.Fatalf("events = %+v", events)
	}
	event := events[0]
	if event.Action != ActionRenewed || event.ActorType != "worker" ||
		event.ActorID != "subscription-renewal" {
		t.Fatalf("event = %+v", event)
	}
	if event.Payload.Before.SubscriptionPeriodEnd != formatInstant(end) {
		t.Fatalf("before snapshot = %+v", event.Payload.Before)
	}
	if event.Payload.After.SubscriptionAnchorAt != formatInstant(anchor) {
		t.Fatalf("after snapshot anchor changed unexpectedly: %+v", event.Payload.After)
	}
	if event.Payload.PeriodsAdvanced == nil || *event.Payload.PeriodsAdvanced != 1 {
		t.Fatalf("periods advanced = %v", event.Payload.PeriodsAdvanced)
	}
}

func TestSystemTransitionEventsChainsThroughTwoTransitions(t *testing.T) {
	t.Parallel()
	anchor := date(2026, time.January, 1, 0)
	end := date(2027, time.January, 1, 0)
	before := paidState(anchor, anchor, end, subscriptionspec.Year)
	before.ScheduledPlan = subscriptionspec.SilverTier
	before.ScheduledInterval = subscriptionspec.Month
	at := date(2027, time.April, 15, 0)
	_, transitions := Advance(before, at)
	if len(transitions) != 2 {
		t.Fatalf("transitions = %+v", transitions)
	}
	events := SystemTransitionEvents(
		"did-1", before, transitions, Actor{Type: "worker", ID: "subscription-renewal"},
	)
	if len(events) != 2 {
		t.Fatalf("events = %+v", events)
	}
	if events[0].Action != ActionScheduledChangeApplied {
		t.Fatalf("first event = %+v", events[0])
	}
	if events[1].Action != ActionRenewed {
		t.Fatalf("second event = %+v", events[1])
	}
	if events[1].Payload.Before != events[0].Payload.After {
		t.Fatalf(
			"chained snapshot mismatch: renewed.before=%+v applied.after=%+v",
			events[1].Payload.Before, events[0].Payload.After,
		)
	}
}

func TestDecisionEventNilForUnchanged(t *testing.T) {
	t.Parallel()
	event := DecisionEvent(
		"did-1", State{Plan: subscriptionspec.FreeTier}, nil,
		Actor{Type: "hub_user", ID: "did-1"},
	)
	if event != nil {
		t.Fatalf("event = %+v, want nil", event)
	}
}

func TestDecisionEventBuildsHubUserEvent(t *testing.T) {
	t.Parallel()
	before := State{Plan: subscriptionspec.FreeTier}
	at := date(2027, time.January, 1, 0)
	next, transition, _ := Decide(
		before, subscriptionspec.SilverTier, subscriptionspec.Month, at,
	)
	event := DecisionEvent(
		"did-1", before, transition, Actor{Type: "hub_user", ID: "did-1"},
	)
	if event == nil {
		t.Fatal("expected a decision event")
	}
	if event.Action != ActionUpgraded || event.ActorType != "hub_user" {
		t.Fatalf("event = %+v", event)
	}
	if event.Payload.After.HubPlanOID != string(next.Plan) {
		t.Fatalf("payload after = %+v", event.Payload.After)
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["hub_user_did"] != "did-1" {
		t.Fatalf("decoded = %v", decoded)
	}
}

func TestNewStateRecordFieldNamesMatchRecordsetColumns(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	state := paidState(anchor, anchor, end, subscriptionspec.Month)
	record := NewStateRecord("did-1", state)
	encoded, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{
		"hub_user_did", "hub_plan_oid", "subscription_billing_interval",
		"subscription_anchor_at", "subscription_period_start",
		"subscription_period_end",
	} {
		if _, ok := decoded[field]; !ok {
			t.Fatalf("missing field %q in %v", field, decoded)
		}
	}
	if _, ok := decoded["scheduled_hub_plan_oid"]; ok {
		t.Fatalf("free schedule fields should be omitted: %v", decoded)
	}
}
