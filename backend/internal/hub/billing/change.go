package billing

import (
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

// Outcome classifies what Decide chose. Only Unchanged writes nothing.
type Outcome string

const (
	Unchanged              Outcome = "unchanged"
	ScheduledChangeCleared Outcome = "scheduled-change-cleared"
	Upgraded               Outcome = "upgraded"
	ChangeScheduled        Outcome = "change-scheduled"
)

// Decide chooses the effect of a user's plan change. It must run on a state
// Advance has already brought up to at, so the current period is never
// already over. The returned Transition is nil exactly when Outcome is
// Unchanged, which is the only outcome that writes nothing.
func Decide(
	current State, plan subscriptionspec.Plan,
	interval subscriptionspec.BillingInterval, at time.Time,
) (State, *Transition, Outcome) {
	if plan == current.Plan && interval == current.Interval {
		if !current.HasSchedule() {
			return current, nil, Unchanged
		}
		cleared := current
		cleared.ScheduledPlan = ""
		cleared.ScheduledInterval = ""
		return cleared,
			&Transition{Kind: KindScheduledChangeCleared, After: cleared},
			ScheduledChangeCleared
	}

	if subscriptionspec.IsUpgrade(
		current.Plan, current.Interval, plan, interval,
	) {
		next := State{Plan: plan}
		if plan != subscriptionspec.FreeTier {
			next.Interval = interval
			next.AnchorAt = at
			next.PeriodStart = at
			next.PeriodEnd = Boundary(at, interval, 1)
		}
		return next, &Transition{Kind: KindUpgraded, After: next}, Upgraded
	}

	if plan == current.ScheduledPlan && interval == current.ScheduledInterval {
		return current, nil, Unchanged
	}

	scheduled := current
	scheduled.ScheduledPlan = plan
	scheduled.ScheduledInterval = interval
	if plan == subscriptionspec.FreeTier {
		scheduled.ScheduledInterval = ""
	}
	return scheduled,
		&Transition{Kind: KindChangeScheduled, After: scheduled},
		ChangeScheduled
}
