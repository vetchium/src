package billing

import (
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

func paidState(
	anchor, start, end time.Time, interval subscriptionspec.BillingInterval,
) State {
	return State{
		Plan: subscriptionspec.SilverTier, Interval: interval,
		AnchorAt: anchor, PeriodStart: start, PeriodEnd: end,
	}
}

func TestAdvanceFreeIsUnchanged(t *testing.T) {
	t.Parallel()
	state := State{Plan: subscriptionspec.FreeTier}
	got, transitions := Advance(state, date(2027, time.June, 1, 0))
	if got != state || transitions != nil {
		t.Fatalf("Advance() = %+v, %v", got, transitions)
	}
}

func TestAdvanceNotYetDueIsUnchanged(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	state := paidState(anchor, anchor, end, subscriptionspec.Month)
	got, transitions := Advance(state, date(2027, time.January, 15, 0))
	if got != state || transitions != nil {
		t.Fatalf("Advance() = %+v, %v", got, transitions)
	}
}

func TestAdvanceBeforePeriodStartIsUnchanged(t *testing.T) {
	t.Parallel()
	// Clock skew: `at` predates the stored period start entirely.
	anchor := date(2027, time.February, 1, 0)
	end := date(2027, time.March, 1, 0)
	state := paidState(anchor, anchor, end, subscriptionspec.Month)
	got, transitions := Advance(state, date(2027, time.January, 1, 0))
	if got != state || transitions != nil {
		t.Fatalf("Advance() = %+v, %v", got, transitions)
	}
}

func TestAdvanceOneMicrosecondBeforeEndIsUnchanged(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	state := paidState(anchor, anchor, end, subscriptionspec.Month)
	got, transitions := Advance(state, end.Add(-time.Microsecond))
	if got != state || transitions != nil {
		t.Fatalf("Advance() = %+v, %v", got, transitions)
	}
}

func TestAdvanceOnePeriodDue(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	state := paidState(anchor, anchor, end, subscriptionspec.Month)
	got, transitions := Advance(state, end)
	if len(transitions) != 1 || transitions[0].Kind != KindRenewed {
		t.Fatalf("transitions = %+v", transitions)
	}
	if transitions[0].PeriodsAdvanced != 1 {
		t.Fatalf("periods advanced = %d, want 1", transitions[0].PeriodsAdvanced)
	}
	wantEnd := date(2027, time.March, 1, 0)
	if !got.PeriodStart.Equal(end) || !got.PeriodEnd.Equal(wantEnd) {
		t.Fatalf("got = %+v", got)
	}
}

func TestAdvanceManyPeriodsDue(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	state := paidState(anchor, anchor, end, subscriptionspec.Month)
	at := date(2027, time.June, 15, 0)
	got, transitions := Advance(state, at)
	if len(transitions) != 1 || transitions[0].Kind != KindRenewed {
		t.Fatalf("transitions = %+v", transitions)
	}
	if transitions[0].PeriodsAdvanced != 5 {
		t.Fatalf("periods advanced = %d, want 5", transitions[0].PeriodsAdvanced)
	}
	if !got.PeriodStart.Equal(date(2027, time.June, 1, 0)) ||
		!got.PeriodEnd.Equal(date(2027, time.July, 1, 0)) {
		t.Fatalf("got = %+v", got)
	}
}

func TestAdvanceDueScheduledCancellation(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	state := paidState(anchor, anchor, end, subscriptionspec.Month)
	state.ScheduledPlan = subscriptionspec.FreeTier
	got, transitions := Advance(state, end)
	if len(transitions) != 1 ||
		transitions[0].Kind != KindScheduledChangeApplied {
		t.Fatalf("transitions = %+v", transitions)
	}
	if got.Plan != subscriptionspec.FreeTier || got.HasSchedule() ||
		!got.AnchorAt.IsZero() || !got.PeriodStart.IsZero() ||
		!got.PeriodEnd.IsZero() {
		t.Fatalf("got = %+v", got)
	}
}

func TestAdvanceDueAnnualToMonthlyNoFurtherPeriod(t *testing.T) {
	t.Parallel()
	anchor := date(2026, time.January, 1, 0)
	end := date(2027, time.January, 1, 0)
	state := paidState(anchor, anchor, end, subscriptionspec.Year)
	state.ScheduledPlan = subscriptionspec.SilverTier
	state.ScheduledInterval = subscriptionspec.Month
	got, transitions := Advance(state, end)
	if len(transitions) != 1 ||
		transitions[0].Kind != KindScheduledChangeApplied {
		t.Fatalf("transitions = %+v", transitions)
	}
	wantEnd := date(2027, time.February, 1, 0)
	if got.Interval != subscriptionspec.Month || !got.AnchorAt.Equal(end) ||
		!got.PeriodStart.Equal(end) || !got.PeriodEnd.Equal(wantEnd) {
		t.Fatalf("got = %+v", got)
	}
}

func TestAdvanceScheduledChangeCrossingFurtherPeriods(t *testing.T) {
	t.Parallel()
	anchor := date(2026, time.January, 1, 0)
	end := date(2027, time.January, 1, 0)
	state := paidState(anchor, anchor, end, subscriptionspec.Year)
	state.ScheduledPlan = subscriptionspec.SilverTier
	state.ScheduledInterval = subscriptionspec.Month
	at := date(2027, time.April, 15, 0)
	got, transitions := Advance(state, at)
	if len(transitions) != 2 {
		t.Fatalf("transitions = %+v, want 2", transitions)
	}
	if transitions[0].Kind != KindScheduledChangeApplied {
		t.Fatalf("first transition = %+v", transitions[0])
	}
	if transitions[1].Kind != KindRenewed {
		t.Fatalf("second transition = %+v", transitions[1])
	}
	// The applied change's first period ends 2027-02-01; renewing to April
	// crosses Feb, Mar, and Apr boundaries, so three periods advance from it.
	if transitions[1].PeriodsAdvanced != 3 {
		t.Fatalf(
			"periods advanced = %d, want 3", transitions[1].PeriodsAdvanced,
		)
	}
	wantStart := date(2027, time.April, 1, 0)
	wantEnd := date(2027, time.May, 1, 0)
	if !got.PeriodStart.Equal(wantStart) || !got.PeriodEnd.Equal(wantEnd) {
		t.Fatalf("got = %+v", got)
	}
}

func TestAdvanceExactlyOnBoundaryInstant(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	state := paidState(anchor, anchor, end, subscriptionspec.Month)
	_, transitions := Advance(state, end)
	if len(transitions) != 1 {
		t.Fatalf("transitions = %+v", transitions)
	}
}
