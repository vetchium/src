package billing

import (
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

// TransitionKind names a system-driven or user-driven subscription change.
// The value is the audit action suffix appended to "hub.subscription.".
type TransitionKind string

const (
	KindUpgraded               TransitionKind = "upgraded"
	KindChangeScheduled        TransitionKind = "change-scheduled"
	KindScheduledChangeCleared TransitionKind = "scheduled-change-cleared"
	KindScheduledChangeApplied TransitionKind = "scheduled-change-applied"
	KindRenewed                TransitionKind = "renewed"
)

// Transition is one state change, ready to become one audit event. Chaining
// several transitions from a starting State reproduces every intermediate
// state a batch save writes in the same statement.
type Transition struct {
	Kind  TransitionKind
	After State

	// PeriodsAdvanced is set only for KindRenewed.
	PeriodsAdvanced int
}

// Advance is the single statement of the period-end rules. The worker,
// set-plan before Decide, and GET (in memory only) all call it, each with
// its own instant.
func Advance(state State, at time.Time) (State, []Transition) {
	if state.Plan == subscriptionspec.FreeTier {
		return state, nil
	}
	// Also covers `at` before the period start, which absorbs clock skew
	// between hosts.
	if at.Before(state.PeriodEnd) {
		return state, nil
	}

	if !state.HasSchedule() {
		return renew(state, state.PeriodEnd, at)
	}

	applied := State{Plan: state.ScheduledPlan}
	if applied.Plan != subscriptionspec.FreeTier {
		applied.Interval = state.ScheduledInterval
		applied.AnchorAt = state.PeriodEnd
		applied.PeriodStart = Boundary(applied.AnchorAt, applied.Interval, 0)
		applied.PeriodEnd = Boundary(applied.AnchorAt, applied.Interval, 1)
	}
	transitions := []Transition{{Kind: KindScheduledChangeApplied, After: applied}}
	if applied.Plan == subscriptionspec.FreeTier || at.Before(applied.PeriodEnd) {
		return applied, transitions
	}
	final, renewals := renew(applied, applied.PeriodEnd, at)
	return final, append(transitions, renewals...)
}

// renew emits one KindRenewed transition, counting how many periods were
// crossed since priorPeriodEnd.
func renew(state State, priorPeriodEnd, at time.Time) (State, []Transition) {
	start, end := PeriodContaining(state.AnchorAt, state.Interval, at)
	state.PeriodStart = start
	state.PeriodEnd = end
	periodsAdvanced := boundaryIndex(state.AnchorAt, state.Interval, end) -
		boundaryIndex(state.AnchorAt, state.Interval, priorPeriodEnd)
	return state, []Transition{{
		Kind: KindRenewed, After: state, PeriodsAdvanced: periodsAdvanced,
	}}
}
