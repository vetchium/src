package billing

import (
	"encoding/json"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

// ActionPrefix starts every subscription audit action; the rest is the
// transition kind.
const ActionPrefix = "org.subscription."

// Actor names who caused an event: an Org user, the worker, or orgs-api
// applying a due transition ahead of a user's own request.
type Actor struct {
	Type string
	ID   string
}

// SystemRenewalActor is orgs-api applying a due transition ahead of a user's
// request, in the same transaction as that request.
var SystemRenewalActor = Actor{Type: "system", ID: "subscription-renewal"}

// WorkerRenewalActor is the background worker applying a due transition on
// its own schedule.
var WorkerRenewalActor = Actor{Type: "worker", ID: "subscription-renewal"}

// OrgUserActor is the Org user who made a change.
func OrgUserActor(orgUserID string) Actor {
	return Actor{Type: "org_user", ID: orgUserID}
}

// Sources name the component that wrote a batch of events.
const (
	SourceOrgsAPI = "orgs-api"
	SourceWorkers = "workers"
)

// EventRecord is one element of the `events` jsonb array parameter of
// SaveOrgSubscription.
type EventRecord struct {
	Action    string          `json:"action"`
	ActorType string          `json:"actor_type"`
	ActorID   string          `json:"actor_id"`
	Payload   StateChangeJSON `json:"payload"`
}

// StateChangeJSON is the before/after payload shared by every transition
// event. It holds no payment detail beyond the card kind's presence.
type StateChangeJSON struct {
	Before StateSnapshot `json:"before"`
	After  StateSnapshot `json:"after"`

	PeriodsAdvanced *int            `json:"periods_advanced,omitempty"`
	Invoice         *InvoiceSummary `json:"invoice,omitempty"`
}

type StateSnapshot struct {
	OrgPlanOID               string `json:"org_plan_oid"`
	OrgBillingInterval       string `json:"org_billing_interval,omitempty"`
	SubscriptionAnchorAt     string `json:"subscription_anchor_at,omitempty"`
	SubscriptionPeriodStart  string `json:"subscription_period_start,omitempty"`
	SubscriptionPeriodEnd    string `json:"subscription_period_end,omitempty"`
	ScheduledOrgPlanOID      string `json:"scheduled_org_plan_oid,omitempty"`
	ScheduledBillingInterval string `json:"scheduled_billing_interval,omitempty"`
	BillingState             string `json:"billing_state"`
}

// InvoiceSummary is the invoice a transition wrote, without anything that
// identifies a payment instrument.
type InvoiceSummary struct {
	Op           InvoiceOp `json:"op"`
	State        string    `json:"state"`
	Reason       string    `json:"reason"`
	Plan         string    `json:"plan_oid"`
	PeriodStart  string    `json:"period_start"`
	PeriodEnd    string    `json:"period_end"`
	AttemptCount int       `json:"attempt_count"`
	LastFailure  string    `json:"last_failure,omitempty"`
}

func formatInstant(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func snapshot(state State) StateSnapshot {
	return StateSnapshot{
		OrgPlanOID:               string(state.Plan),
		OrgBillingInterval:       string(state.Interval),
		SubscriptionAnchorAt:     formatInstant(state.AnchorAt),
		SubscriptionPeriodStart:  formatInstant(state.PeriodStart),
		SubscriptionPeriodEnd:    formatInstant(state.PeriodEnd),
		ScheduledOrgPlanOID:      string(state.ScheduledPlan),
		ScheduledBillingInterval: string(state.ScheduledInterval),
		BillingState:             string(state.Billing),
	}
}

func summarize(change *InvoiceChange) *InvoiceSummary {
	if change == nil {
		return nil
	}
	invoice := change.Invoice
	return &InvoiceSummary{
		Op:           change.Op,
		State:        string(invoice.State),
		Reason:       string(invoice.Reason),
		Plan:         string(invoice.Plan),
		PeriodStart:  formatInstant(invoice.PeriodStart),
		PeriodEnd:    formatInstant(invoice.PeriodEnd),
		AttemptCount: invoice.AttemptCount,
		LastFailure:  string(invoice.LastFailure),
	}
}

func action(kind TransitionKind) string { return ActionPrefix + string(kind) }

// TransitionEvents builds one event per transition, chaining snapshots from
// before through each transition's resulting state.
func TransitionEvents(
	before State, transitions []Transition, actor Actor,
) []EventRecord {
	events := make([]EventRecord, 0, len(transitions))
	prior := before
	for _, transition := range transitions {
		var periodsAdvanced *int
		if transition.Kind == KindRenewed {
			periodsAdvanced = &transition.PeriodsAdvanced
		}
		events = append(events, EventRecord{
			Action:    action(transition.Kind),
			ActorType: actor.Type,
			ActorID:   actor.ID,
			Payload: StateChangeJSON{
				Before:          snapshot(prior),
				After:           snapshot(transition.After),
				PeriodsAdvanced: periodsAdvanced,
				Invoice:         summarize(transition.Invoice),
			},
		})
		prior = transition.After
	}
	return events
}

// DecisionEvent builds the audit event for a Decide or Pay outcome, attributed
// to actor. It returns nil when the transition is nil.
func DecisionEvent(
	before State, decision *Transition, actor Actor,
) *EventRecord {
	if decision == nil {
		return nil
	}
	return &EventRecord{
		Action:    action(decision.Kind),
		ActorType: actor.Type,
		ActorID:   actor.ID,
		Payload: StateChangeJSON{
			Before:  snapshot(before),
			After:   snapshot(decision.After),
			Invoice: summarize(decision.Invoice),
		},
	}
}

// InvoiceChangeRecord is one element of the `invoice_changes` jsonb array
// parameter of SaveOrgSubscription.
type InvoiceChangeRecord struct {
	Op           InvoiceOp `json:"op"`
	PlanOID      string    `json:"plan_oid,omitempty"`
	Interval     string    `json:"billing_interval,omitempty"`
	PeriodStart  string    `json:"period_start,omitempty"`
	PeriodEnd    string    `json:"period_end,omitempty"`
	Reason       string    `json:"reason,omitempty"`
	State        string    `json:"state,omitempty"`
	DueAt        string    `json:"due_at,omitempty"`
	AttemptCount int       `json:"attempt_count,omitempty"`
	NextAttempt  string    `json:"next_attempt_at,omitempty"`
	LastFailure  string    `json:"last_failure,omitempty"`
	PaidAt       string    `json:"paid_at,omitempty"`
	VoidedAt     string    `json:"voided_at,omitempty"`
}

// InvoiceChangesJSON encodes folded changes for SaveOrgSubscription. It always
// encodes an array, never null.
func InvoiceChangesJSON(changes []InvoiceChange) ([]byte, error) {
	records := make([]InvoiceChangeRecord, 0, len(changes))
	for _, change := range changes {
		invoice := change.Invoice
		records = append(records, InvoiceChangeRecord{
			Op:           change.Op,
			PlanOID:      string(invoice.Plan),
			Interval:     string(invoice.Interval),
			PeriodStart:  formatInstant(invoice.PeriodStart),
			PeriodEnd:    formatInstant(invoice.PeriodEnd),
			Reason:       string(invoice.Reason),
			State:        string(invoice.State),
			DueAt:        formatInstant(invoice.DueAt),
			AttemptCount: invoice.AttemptCount,
			NextAttempt:  formatInstant(invoice.NextAttemptAt),
			LastFailure:  string(invoice.LastFailure),
			PaidAt:       formatInstant(invoice.PaidAt),
			VoidedAt:     formatInstant(invoice.VoidedAt),
		})
	}
	return json.Marshal(records)
}

// EventsJSON encodes events for SaveOrgSubscription as an array.
func EventsJSON(events []EventRecord) ([]byte, error) {
	if events == nil {
		events = []EventRecord{}
	}
	return json.Marshal(events)
}

// Valid reports whether the change can be written: an open invoice needs its
// deadline and failure.
func (c InvoiceChange) Valid() bool {
	if c.Invoice.State == subscriptionspec.InvoiceOpen {
		return !c.Invoice.DueAt.IsZero() && c.Invoice.LastFailure != ""
	}
	return true
}
