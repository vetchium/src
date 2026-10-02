package billing

import (
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

func request(plan subscriptionspec.Plan, interval subscriptionspec.BillingInterval, seats int) Request {
	return Request{Plan: plan, Interval: interval, Seats: seats}
}

func TestDecideReselectingTheCurrentPlan(t *testing.T) {
	t.Parallel()
	now := date(2027, time.January, 10, 0)
	state := monthlySilver()
	got := Decide(state, request(subscriptionspec.SilverTier, subscriptionspec.Month, 3), now, alwaysPaid)
	if got.Outcome != Unchanged || got.Transition != nil {
		t.Fatalf("Decide() = %+v", got)
	}

	state.ScheduledPlan = subscriptionspec.FreeTier
	got = Decide(state, request(subscriptionspec.SilverTier, subscriptionspec.Month, 3), now, alwaysPaid)
	if got.Outcome != ScheduledChangeCleared || got.Transition == nil ||
		got.Transition.Kind != KindScheduledChangeCleared || got.State.HasSchedule() {
		t.Fatalf("Decide() = %+v", got)
	}
	if !got.State.PeriodEnd.Equal(state.PeriodEnd) {
		t.Fatal("clearing a schedule must not move the period")
	}
}

func TestDecideUpgradesChargeImmediatelyAndStartANewPeriod(t *testing.T) {
	t.Parallel()
	now := date(2027, time.January, 10, 6)
	cases := []struct {
		name  string
		start State
		to    Request
	}{
		{"free to silver", freeState(), request(subscriptionspec.SilverTier, subscriptionspec.Month, 1)},
		{"silver to gold", monthlySilver(), request(subscriptionspec.GoldTier, subscriptionspec.Year, 1)},
		{"monthly to annual", monthlySilver(), request(subscriptionspec.SilverTier, subscriptionspec.Year, 1)},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			start := testCase.start
			start.PaymentMethod = subscriptionspec.SimulatedSucceeds
			start.ScheduledPlan = ""
			got := Decide(start, testCase.to, now, alwaysPaid)
			if got.Outcome != Upgraded || got.Transition == nil ||
				got.Transition.Kind != KindUpgraded {
				t.Fatalf("Decide() = %+v", got)
			}
			next := got.State
			if next.Plan != testCase.to.Plan || next.Interval != testCase.to.Interval ||
				!next.AnchorAt.Equal(now) || !next.PeriodStart.Equal(now) ||
				!next.PeriodEnd.Equal(Boundary(now, testCase.to.Interval, 1)) ||
				next.PastDue() || next.HasSchedule() {
				t.Fatalf("state = %+v", next)
			}
			change := got.Transition.Invoice
			if change == nil || change.Op != InvoiceCreate ||
				change.Invoice.Reason != subscriptionspec.ReasonUpgrade ||
				change.Invoice.State != subscriptionspec.InvoicePaid ||
				!change.Invoice.PaidAt.Equal(now) {
				t.Fatalf("invoice = %+v", change)
			}
		})
	}
}

func TestDecideUpgradeClearsASchedule(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	state.ScheduledPlan = subscriptionspec.FreeTier
	got := Decide(state, request(subscriptionspec.GoldTier, subscriptionspec.Month, 1),
		date(2027, time.January, 10, 0), alwaysPaid)
	if got.Outcome != Upgraded || got.State.HasSchedule() {
		t.Fatalf("Decide() = %+v", got)
	}
}

func TestDecideRefusesAnUpgradeItCannotCollect(t *testing.T) {
	t.Parallel()
	now := date(2027, time.January, 10, 0)
	for name, testCase := range map[string]struct {
		charger Charger
		want    Refusal
	}{
		"no card":  {noMethod, RefusalPaymentMethodRequired},
		"declined": {alwaysDeclined, RefusalPaymentDeclined},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			state := freeState()
			got := Decide(state, request(subscriptionspec.SilverTier, subscriptionspec.Month, 1), now, testCase.charger)
			if got.Outcome != Refused || got.Refusal != testCase.want ||
				got.Transition != nil || got.State.Plan != subscriptionspec.FreeTier {
				t.Fatalf("Decide() = %+v", got)
			}
		})
	}
}

func TestDecideSchedulesDowngradesForPeriodEnd(t *testing.T) {
	t.Parallel()
	now := date(2027, time.January, 10, 0)
	gold := monthlySilver()
	gold.Plan = subscriptionspec.GoldTier
	cases := []struct {
		name         string
		start        State
		to           Request
		wantPlan     subscriptionspec.Plan
		wantInterval subscriptionspec.BillingInterval
	}{
		{"gold to silver", gold, request(subscriptionspec.SilverTier, subscriptionspec.Month, 40), subscriptionspec.SilverTier, subscriptionspec.Month},
		{"silver to free", monthlySilver(), request(subscriptionspec.FreeTier, "", 5), subscriptionspec.FreeTier, ""},
		{
			"annual to monthly", func() State {
				state := monthlySilver()
				state.Interval = subscriptionspec.Year
				state.PeriodEnd = date(2028, time.January, 1, 0)
				return state
			}(),
			request(subscriptionspec.SilverTier, subscriptionspec.Month, 10),
			subscriptionspec.SilverTier, subscriptionspec.Month,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got := Decide(testCase.start, testCase.to, now, alwaysPaid)
			if got.Outcome != ChangeScheduled || got.Transition == nil ||
				got.Transition.Kind != KindChangeScheduled ||
				got.State.ScheduledPlan != testCase.wantPlan ||
				got.State.ScheduledInterval != testCase.wantInterval {
				t.Fatalf("Decide() = %+v", got)
			}
			if got.State.Plan != testCase.start.Plan ||
				!got.State.PeriodEnd.Equal(testCase.start.PeriodEnd) {
				t.Fatal("a downgrade must keep the current plan and period")
			}
			if got.Transition.Invoice != nil {
				t.Fatal("scheduling charges nothing")
			}
		})
	}
}

func TestDecideRepeatingTheScheduledChangeIsUnchanged(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	state.ScheduledPlan = subscriptionspec.FreeTier
	got := Decide(state, request(subscriptionspec.FreeTier, "", 2), date(2027, time.January, 10, 0), alwaysPaid)
	if got.Outcome != Unchanged || got.Transition != nil {
		t.Fatalf("Decide() = %+v", got)
	}
}

func TestDecideBlocksADowngradeUntilTheOrgFits(t *testing.T) {
	t.Parallel()
	now := date(2027, time.January, 10, 0)
	gold := monthlySilver()
	gold.Plan = subscriptionspec.GoldTier
	cases := []struct {
		name      string
		start     State
		to        Request
		wantLimit int
		blocked   bool
	}{
		{"silver to free, 6 seats", monthlySilver(), request(subscriptionspec.FreeTier, "", 6), 5, true},
		{"silver to free, 5 seats", monthlySilver(), request(subscriptionspec.FreeTier, "", 5), 5, false},
		{"gold to silver, 51 seats", gold, request(subscriptionspec.SilverTier, subscriptionspec.Month, 51), 50, true},
		{"gold to silver, 50 seats", gold, request(subscriptionspec.SilverTier, subscriptionspec.Month, 50), 50, false},
		{"gold to free, 1000 seats", gold, request(subscriptionspec.FreeTier, "", 1000), 5, true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got := Decide(testCase.start, testCase.to, now, alwaysPaid)
			if testCase.blocked {
				if got.Outcome != Refused || got.Refusal != RefusalSeatLimit ||
					got.TargetLimit != testCase.wantLimit || got.Transition != nil ||
					got.State.HasSchedule() {
					t.Fatalf("Decide() = %+v", got)
				}
				return
			}
			if got.Outcome != ChangeScheduled {
				t.Fatalf("Decide() = %+v", got)
			}
		})
	}
}

func TestDecideRefusesEverythingWhilePastDue(t *testing.T) {
	t.Parallel()
	now := date(2027, time.February, 2, 0)
	for _, to := range []Request{
		request(subscriptionspec.SilverTier, subscriptionspec.Month, 1),
		request(subscriptionspec.GoldTier, subscriptionspec.Month, 1),
		request(subscriptionspec.FreeTier, "", 1),
	} {
		got := Decide(pastDue(), to, now, alwaysPaid)
		if got.Outcome != Refused || got.Refusal != RefusalPastDue || got.Transition != nil {
			t.Fatalf("Decide(%+v) = %+v", to, got)
		}
	}
}
