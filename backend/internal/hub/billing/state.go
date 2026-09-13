package billing

import (
	"fmt"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

// Stored is the database-free input to StateFromStored. Interval and
// ScheduledInterval are empty when the corresponding database column is
// null.
type Stored struct {
	HubUserDID string

	PlanOID  string
	Interval string

	AnchorAt    *time.Time
	PeriodStart *time.Time
	PeriodEnd   *time.Time

	ScheduledPlanOID  string
	ScheduledInterval string
}

type State struct {
	Plan     subscriptionspec.Plan
	Interval subscriptionspec.BillingInterval

	AnchorAt    time.Time
	PeriodStart time.Time
	PeriodEnd   time.Time

	ScheduledPlan     subscriptionspec.Plan
	ScheduledInterval subscriptionspec.BillingInterval
}

func (s State) HasSchedule() bool {
	return s.ScheduledPlan != ""
}

// StateFromStored validates a database row into a State. It rejects a plan
// or scheduled plan the contract does not define, and a paid state whose
// period is not a boundary pair of its anchor.
func StateFromStored(stored Stored) (State, error) {
	plan := subscriptionspec.Plan(stored.PlanOID)
	if !subscriptionspec.IsPlan(subscriptionspec.PlanOID(plan)) {
		return State{}, fmt.Errorf(
			"hub user %s: unknown plan %q", stored.HubUserDID, stored.PlanOID,
		)
	}

	state := State{Plan: plan}
	if plan != subscriptionspec.FreeTier {
		if stored.AnchorAt == nil || stored.PeriodStart == nil ||
			stored.PeriodEnd == nil {
			return State{}, fmt.Errorf(
				"hub user %s: paid plan %q has no period",
				stored.HubUserDID, stored.PlanOID,
			)
		}
		state.Interval = subscriptionspec.BillingInterval(stored.Interval)
		state.AnchorAt = Instant(*stored.AnchorAt)
		state.PeriodStart = Instant(*stored.PeriodStart)
		state.PeriodEnd = Instant(*stored.PeriodEnd)
		start, end := PeriodContaining(
			state.AnchorAt, state.Interval, state.PeriodStart,
		)
		if !start.Equal(state.PeriodStart) || !end.Equal(state.PeriodEnd) {
			return State{}, fmt.Errorf(
				"hub user %s: period is not a boundary pair of its anchor",
				stored.HubUserDID,
			)
		}
	}

	if stored.ScheduledPlanOID != "" {
		scheduledPlan := subscriptionspec.Plan(stored.ScheduledPlanOID)
		if !subscriptionspec.IsPlan(subscriptionspec.PlanOID(scheduledPlan)) {
			return State{}, fmt.Errorf(
				"hub user %s: unknown scheduled plan %q",
				stored.HubUserDID, stored.ScheduledPlanOID,
			)
		}
		state.ScheduledPlan = scheduledPlan
		state.ScheduledInterval = subscriptionspec.BillingInterval(
			stored.ScheduledInterval,
		)
	}

	return state, nil
}
