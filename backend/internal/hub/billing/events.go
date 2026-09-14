package billing

import "time"

const (
	ActionUpgraded               = "hub.subscription.upgraded"
	ActionChangeScheduled        = "hub.subscription.change-scheduled"
	ActionScheduledChangeCleared = "hub.subscription.scheduled-change-cleared"
	ActionScheduledChangeApplied = "hub.subscription.scheduled-change-applied"
	ActionRenewed                = "hub.subscription.renewed"
)

var actionNames = map[TransitionKind]string{
	KindUpgraded:               ActionUpgraded,
	KindChangeScheduled:        ActionChangeScheduled,
	KindScheduledChangeCleared: ActionScheduledChangeCleared,
	KindScheduledChangeApplied: ActionScheduledChangeApplied,
	KindRenewed:                ActionRenewed,
}

func actionName(kind TransitionKind) string {
	return actionNames[kind]
}

// StateRecord is one element of the sqlc `states` jsonb array parameter for
// SaveHubSubscriptionStates.
type StateRecord struct {
	HubUserDID string `json:"hub_user_did"`
	StateSnapshot
}

// EventRecord is one element of the sqlc `events` jsonb array parameter for
// SaveHubSubscriptionStates.
type EventRecord struct {
	HubUserDID string          `json:"hub_user_did"`
	Action     string          `json:"action"`
	ActorType  string          `json:"actor_type"`
	ActorID    string          `json:"actor_id"`
	Payload    StateChangeJSON `json:"payload"`
}

// StateChangeJSON is the before/after snapshot payload shared by every
// subscription transition event, with periods_advanced present only on a
// renewal.
type StateChangeJSON struct {
	Before StateSnapshot `json:"before"`
	After  StateSnapshot `json:"after"`

	PeriodsAdvanced *int `json:"periods_advanced,omitempty"`
}

type StateSnapshot struct {
	HubPlanOID                  string `json:"hub_plan_oid"`
	SubscriptionBillingInterval string `json:"subscription_billing_interval,omitempty"`
	SubscriptionAnchorAt        string `json:"subscription_anchor_at,omitempty"`
	SubscriptionPeriodStart     string `json:"subscription_period_start,omitempty"`
	SubscriptionPeriodEnd       string `json:"subscription_period_end,omitempty"`
	ScheduledHubPlanOID         string `json:"scheduled_hub_plan_oid,omitempty"`
	ScheduledBillingInterval    string `json:"scheduled_billing_interval,omitempty"`
}

func formatInstant(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func snapshot(state State) StateSnapshot {
	return StateSnapshot{
		HubPlanOID:                  string(state.Plan),
		SubscriptionBillingInterval: string(state.Interval),
		SubscriptionAnchorAt:        formatInstant(state.AnchorAt),
		SubscriptionPeriodStart:     formatInstant(state.PeriodStart),
		SubscriptionPeriodEnd:       formatInstant(state.PeriodEnd),
		ScheduledHubPlanOID:         string(state.ScheduledPlan),
		ScheduledBillingInterval:    string(state.ScheduledInterval),
	}
}

// NewStateRecord builds the states recordset element for the final state a
// save writes.
func NewStateRecord(hubUserDID string, state State) StateRecord {
	return StateRecord{HubUserDID: hubUserDID, StateSnapshot: snapshot(state)}
}

// Actor names who caused an event: a Hub user, the worker, or hub-api acting
// as system for a period-end transition applied ahead of a user's request.
type Actor struct {
	Type string
	ID   string
}

// SystemRenewalActor is hub-api applying a due period-end transition ahead of
// a user's own request, in the same transaction as that request.
var SystemRenewalActor = Actor{Type: "system", ID: "subscription-renewal"}

// WorkerRenewalActor is the background worker applying a due period-end
// transition on its own schedule.
var WorkerRenewalActor = Actor{Type: "worker", ID: "subscription-renewal"}

// HubUserActor is the Hub user who chose a plan change.
func HubUserActor(hubUserDID string) Actor {
	return Actor{Type: "hub_user", ID: hubUserDID}
}

// Source names the component that wrote a batch of subscription events, for
// SaveHubSubscriptionStatesParams.Source.
const (
	SourceHubAPI  = "hub-api"
	SourceWorkers = "workers"
)

// SystemTransitionEvents builds one event per Advance transition, chaining
// snapshots from before through each transition's resulting state.
func SystemTransitionEvents(
	hubUserDID string, before State, transitions []Transition, actor Actor,
) []EventRecord {
	events := make([]EventRecord, 0, len(transitions))
	prior := before
	for _, transition := range transitions {
		var periodsAdvanced *int
		if transition.Kind == KindRenewed {
			periodsAdvanced = &transition.PeriodsAdvanced
		}
		events = append(events, EventRecord{
			HubUserDID: hubUserDID,
			Action:     actionName(transition.Kind),
			ActorType:  actor.Type,
			ActorID:    actor.ID,
			Payload: StateChangeJSON{
				Before:          snapshot(prior),
				After:           snapshot(transition.After),
				PeriodsAdvanced: periodsAdvanced,
			},
		})
		prior = transition.After
	}
	return events
}

// DecisionEvent builds the audit event for a Decide outcome, attributed to
// actor. It returns nil when decision is nil, which is Decide's Unchanged
// outcome.
func DecisionEvent(
	hubUserDID string, before State, decision *Transition, actor Actor,
) *EventRecord {
	if decision == nil {
		return nil
	}
	return &EventRecord{
		HubUserDID: hubUserDID,
		Action:     actionName(decision.Kind),
		ActorType:  actor.Type,
		ActorID:    actor.ID,
		Payload: StateChangeJSON{
			Before: snapshot(before),
			After:  snapshot(decision.After),
		},
	}
}
