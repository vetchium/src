package billing

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

func TestTransitionEventsChainSnapshotsAndNameActors(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	_, transitions := Advance(state, date(2027, time.April, 2, 0), testConfig, alwaysPaid)
	events := TransitionEvents(state, transitions, SystemRenewalActor)
	if len(events) != 3 {
		t.Fatalf("events = %d", len(events))
	}
	for index, event := range events {
		if event.Action != "org.subscription.renewed" ||
			event.ActorType != "system" || event.ActorID != "subscription-renewal" ||
			event.Payload.PeriodsAdvanced == nil || *event.Payload.PeriodsAdvanced != 1 {
			t.Fatalf("event %d = %+v", index, event)
		}
		if event.Payload.Invoice == nil || event.Payload.Invoice.State != "paid" {
			t.Fatalf("event %d invoice = %+v", index, event.Payload.Invoice)
		}
	}
	if events[0].Payload.Before.SubscriptionPeriodEnd != "2027-02-01T00:00:00Z" ||
		events[0].Payload.After.SubscriptionPeriodEnd != "2027-03-01T00:00:00Z" ||
		events[1].Payload.Before.SubscriptionPeriodEnd != events[0].Payload.After.SubscriptionPeriodEnd {
		t.Fatalf("snapshots do not chain: %+v", events)
	}
}

func TestEventsCarryNoPaymentInstrumentOrSecrets(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	decision := Decide(state, request(subscriptionspec.GoldTier, subscriptionspec.Year, 1),
		date(2027, time.January, 5, 0), alwaysPaid)
	event := DecisionEvent(state, decision.Transition, OrgUserActor("user-1"))
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	for _, forbidden := range []string{"simulated", "card", "4242", "token"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("event leaks %q: %s", forbidden, text)
		}
	}
	if event.Action != "org.subscription.upgraded" || event.ActorType != "org_user" ||
		event.Payload.After.OrgPlanOID != "org-gold-tier" ||
		event.Payload.After.BillingState != "current" {
		t.Fatalf("event = %+v", event)
	}
	if DecisionEvent(state, nil, OrgUserActor("user-1")) != nil {
		t.Fatal("an unchanged decision must produce no event")
	}
}

func TestEventsJSONEncodesAnArray(t *testing.T) {
	t.Parallel()
	encoded, err := EventsJSON(nil)
	if err != nil || string(encoded) != "[]" {
		t.Fatalf("EventsJSON(nil) = %s, %v", encoded, err)
	}
}

func TestInvoiceChangeValid(t *testing.T) {
	t.Parallel()
	open := InvoiceChange{Op: InvoiceCreate, Invoice: Invoice{State: subscriptionspec.InvoiceOpen}}
	if open.Valid() {
		t.Fatal("an open invoice without a deadline was valid")
	}
	open.Invoice.DueAt = date(2027, 1, 1, 0)
	open.Invoice.LastFailure = subscriptionspec.FailureDeclined
	if !open.Valid() {
		t.Fatal("a complete open invoice was invalid")
	}
}
