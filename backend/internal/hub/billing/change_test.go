package billing

import (
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

func TestDecide(t *testing.T) {
	t.Parallel()
	anchorMonth := date(2027, time.January, 1, 0)
	endMonth := date(2027, time.February, 1, 0)
	anchorYear := date(2027, time.January, 1, 0)
	endYear := date(2028, time.January, 1, 0)

	cases := []struct {
		name        string
		state       State
		toPlan      subscriptionspec.Plan
		toInterval  subscriptionspec.BillingInterval
		at          time.Time
		wantOutcome Outcome
		wantKind    TransitionKind
		check       func(t *testing.T, next State, transition *Transition)
	}{
		{
			name:        "unchanged, no schedule",
			state:       State{Plan: subscriptionspec.FreeTier},
			toPlan:      subscriptionspec.FreeTier,
			at:          date(2027, time.January, 1, 0),
			wantOutcome: Unchanged,
			check: func(t *testing.T, next State, _ *Transition) {
				if next != (State{Plan: subscriptionspec.FreeTier}) {
					t.Fatalf("next = %+v", next)
				}
			},
		},
		{
			name: "clears a scheduled change",
			state: func() State {
				state := paidState(anchorMonth, anchorMonth, endMonth, subscriptionspec.Month)
				state.ScheduledPlan = subscriptionspec.FreeTier
				return state
			}(),
			toPlan:      subscriptionspec.SilverTier,
			toInterval:  subscriptionspec.Month,
			at:          anchorMonth,
			wantOutcome: ScheduledChangeCleared,
			wantKind:    KindScheduledChangeCleared,
			check: func(t *testing.T, next State, _ *Transition) {
				if next.HasSchedule() {
					t.Fatalf("schedule not cleared: %+v", next)
				}
			},
		},
		{
			name:        "upgrade free to silver",
			state:       State{Plan: subscriptionspec.FreeTier},
			toPlan:      subscriptionspec.SilverTier,
			toInterval:  subscriptionspec.Month,
			at:          date(2027, time.January, 5, 12),
			wantOutcome: Upgraded,
			wantKind:    KindUpgraded,
			check: func(t *testing.T, next State, _ *Transition) {
				at := date(2027, time.January, 5, 12)
				want := date(2027, time.February, 5, 12)
				if next.Plan != subscriptionspec.SilverTier ||
					!next.AnchorAt.Equal(at) || !next.PeriodStart.Equal(at) ||
					!next.PeriodEnd.Equal(want) {
					t.Fatalf("next = %+v", next)
				}
			},
		},
		{
			name:        "upgrade monthly to annual",
			state:       paidState(anchorMonth, anchorMonth, endMonth, subscriptionspec.Month),
			toPlan:      subscriptionspec.SilverTier,
			toInterval:  subscriptionspec.Year,
			at:          date(2027, time.January, 20, 0),
			wantOutcome: Upgraded,
			wantKind:    KindUpgraded,
			check: func(t *testing.T, next State, _ *Transition) {
				at := date(2027, time.January, 20, 0)
				if next.Interval != subscriptionspec.Year || !next.AnchorAt.Equal(at) {
					t.Fatalf("next = %+v", next)
				}
			},
		},
		{
			// Monthly silver with a scheduled cancellation; switching to
			// annual is an upgrade (same plan, month to year), which must
			// clear the cancellation and apply immediately rather than
			// merely clearing the schedule.
			name: "upgrade clears a scheduled downgrade",
			state: func() State {
				state := paidState(anchorMonth, anchorMonth, endMonth, subscriptionspec.Month)
				state.ScheduledPlan = subscriptionspec.FreeTier
				return state
			}(),
			toPlan:      subscriptionspec.SilverTier,
			toInterval:  subscriptionspec.Year,
			at:          date(2027, time.January, 10, 0),
			wantOutcome: Upgraded,
			wantKind:    KindUpgraded,
			check: func(t *testing.T, next State, _ *Transition) {
				at := date(2027, time.January, 10, 0)
				if next.HasSchedule() {
					t.Fatalf("scheduled cancellation was not cleared: %+v", next)
				}
				if next.Interval != subscriptionspec.Year || !next.AnchorAt.Equal(at) {
					t.Fatalf("upgrade did not apply immediately: %+v", next)
				}
			},
		},
		{
			name:        "annual to monthly is scheduled",
			state:       paidState(anchorYear, anchorYear, endYear, subscriptionspec.Year),
			toPlan:      subscriptionspec.SilverTier,
			toInterval:  subscriptionspec.Month,
			at:          date(2027, time.June, 1, 0),
			wantOutcome: ChangeScheduled,
			wantKind:    KindChangeScheduled,
			check: func(t *testing.T, next State, _ *Transition) {
				if next.ScheduledPlan != subscriptionspec.SilverTier ||
					next.ScheduledInterval != subscriptionspec.Month {
					t.Fatalf("next = %+v", next)
				}
				// The current, unexpired period is untouched.
				if !next.PeriodStart.Equal(anchorYear) || !next.PeriodEnd.Equal(endYear) {
					t.Fatalf("current period changed: %+v", next)
				}
			},
		},
		{
			name:        "annual to free is scheduled",
			state:       paidState(anchorYear, anchorYear, endYear, subscriptionspec.Year),
			toPlan:      subscriptionspec.FreeTier,
			at:          date(2027, time.June, 1, 0),
			wantOutcome: ChangeScheduled,
			wantKind:    KindChangeScheduled,
			check: func(t *testing.T, next State, _ *Transition) {
				if next.ScheduledPlan != subscriptionspec.FreeTier ||
					next.ScheduledInterval != "" {
					t.Fatalf("next = %+v", next)
				}
			},
		},
		{
			name:        "cancellation is scheduled",
			state:       paidState(anchorMonth, anchorMonth, endMonth, subscriptionspec.Month),
			toPlan:      subscriptionspec.FreeTier,
			at:          date(2027, time.January, 10, 0),
			wantOutcome: ChangeScheduled,
			wantKind:    KindChangeScheduled,
			check: func(t *testing.T, next State, _ *Transition) {
				if next.ScheduledPlan != subscriptionspec.FreeTier ||
					next.ScheduledInterval != "" {
					t.Fatalf("next = %+v", next)
				}
			},
		},
		{
			name:        "re-choosing the current plan is unchanged",
			state:       paidState(anchorMonth, anchorMonth, endMonth, subscriptionspec.Month),
			toPlan:      subscriptionspec.SilverTier,
			toInterval:  subscriptionspec.Month,
			at:          date(2027, time.January, 10, 0),
			wantOutcome: Unchanged,
			check: func(t *testing.T, next State, _ *Transition) {
				want := paidState(anchorMonth, anchorMonth, endMonth, subscriptionspec.Month)
				if next != want {
					t.Fatalf("next = %+v", next)
				}
			},
		},
		{
			name: "re-choosing the scheduled target is unchanged",
			state: func() State {
				state := paidState(anchorYear, anchorYear, endYear, subscriptionspec.Year)
				state.ScheduledPlan = subscriptionspec.SilverTier
				state.ScheduledInterval = subscriptionspec.Month
				return state
			}(),
			toPlan:      subscriptionspec.SilverTier,
			toInterval:  subscriptionspec.Month,
			at:          date(2027, time.June, 1, 0),
			wantOutcome: Unchanged,
		},
		{
			name: "a second downgrade replaces the first",
			state: func() State {
				state := paidState(anchorYear, anchorYear, endYear, subscriptionspec.Year)
				state.ScheduledPlan = subscriptionspec.SilverTier
				state.ScheduledInterval = subscriptionspec.Month
				return state
			}(),
			toPlan:      subscriptionspec.FreeTier,
			at:          date(2027, time.June, 1, 0),
			wantOutcome: ChangeScheduled,
			wantKind:    KindChangeScheduled,
			check: func(t *testing.T, next State, _ *Transition) {
				if next.ScheduledPlan != subscriptionspec.FreeTier {
					t.Fatalf(
						"next = %+v, want the new schedule to replace the old one",
						next,
					)
				}
			},
		},
		{
			// A scheduled cancellation replaced by a downgrade in interval,
			// not by another plan: distinct from replacing one non-free
			// scheduled plan with another.
			name: "replacing a scheduled cancellation with annual to monthly",
			state: func() State {
				state := paidState(anchorYear, anchorYear, endYear, subscriptionspec.Year)
				state.ScheduledPlan = subscriptionspec.FreeTier
				return state
			}(),
			toPlan:      subscriptionspec.SilverTier,
			toInterval:  subscriptionspec.Month,
			at:          date(2027, time.June, 1, 0),
			wantOutcome: ChangeScheduled,
			wantKind:    KindChangeScheduled,
			check: func(t *testing.T, next State, _ *Transition) {
				if next.ScheduledPlan != subscriptionspec.SilverTier ||
					next.ScheduledInterval != subscriptionspec.Month {
					t.Fatalf(
						"next = %+v, want the cancellation replaced by month",
						next,
					)
				}
			},
		},
		{
			name: "clearing a scheduled silver monthly by re-choosing annual",
			state: func() State {
				state := paidState(anchorYear, anchorYear, endYear, subscriptionspec.Year)
				state.ScheduledPlan = subscriptionspec.SilverTier
				state.ScheduledInterval = subscriptionspec.Month
				return state
			}(),
			toPlan:      subscriptionspec.SilverTier,
			toInterval:  subscriptionspec.Year,
			at:          date(2027, time.June, 1, 0),
			wantOutcome: ScheduledChangeCleared,
			wantKind:    KindScheduledChangeCleared,
			check: func(t *testing.T, next State, _ *Transition) {
				if next.HasSchedule() {
					t.Fatalf("schedule not cleared: %+v", next)
				}
			},
		},
	}

	for _, testCase := range cases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			next, transition, outcome := Decide(
				testCase.state, testCase.toPlan, testCase.toInterval, testCase.at,
			)
			if outcome != testCase.wantOutcome {
				t.Fatalf("outcome = %v, want %v", outcome, testCase.wantOutcome)
			}
			if testCase.wantKind == "" {
				if transition != nil {
					t.Fatalf("transition = %+v, want nil", transition)
				}
			} else if transition == nil || transition.Kind != testCase.wantKind {
				t.Fatalf(
					"transition = %+v, want kind %v", transition, testCase.wantKind,
				)
			}
			if testCase.check != nil {
				testCase.check(t, next, transition)
			}
		})
	}
}
