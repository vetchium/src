package billing

import (
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

func kinds(transitions []Transition) []TransitionKind {
	result := make([]TransitionKind, len(transitions))
	for index, transition := range transitions {
		result[index] = transition.Kind
	}
	return result
}

func assertKinds(t *testing.T, got []Transition, want ...TransitionKind) {
	t.Helper()
	gotKinds := kinds(got)
	if len(gotKinds) != len(want) {
		t.Fatalf("kinds = %v, want %v", gotKinds, want)
	}
	for index := range want {
		if gotKinds[index] != want[index] {
			t.Fatalf("kinds = %v, want %v", gotKinds, want)
		}
	}
}

func TestAdvanceDoesNothingBeforeDueOrOnFree(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	for _, at := range []time.Time{
		state.PeriodStart.Add(-time.Hour), state.PeriodStart, state.PeriodEnd.Add(-time.Microsecond),
	} {
		got, transitions := Advance(state, at, testConfig, alwaysPaid)
		if len(transitions) != 0 || got.PeriodEnd != state.PeriodEnd {
			t.Fatalf("Advance(%v) = %+v, %v", at, got, kinds(transitions))
		}
	}
	got, transitions := Advance(freeState(), date(2030, 1, 1, 0), testConfig, alwaysDeclined)
	if len(transitions) != 0 || got.Plan != subscriptionspec.FreeTier {
		t.Fatalf("free Advance() = %+v, %v", got, kinds(transitions))
	}
}

func TestAdvanceRenewsAndRecordsAPaidInvoice(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	at := state.PeriodEnd.Add(2 * time.Hour)
	got, transitions := Advance(state, at, testConfig, alwaysPaid)
	assertKinds(t, transitions, KindRenewed)
	if !got.PeriodStart.Equal(date(2027, time.February, 1, 0)) ||
		!got.PeriodEnd.Equal(date(2027, time.March, 1, 0)) {
		t.Fatalf("period = %v..%v", got.PeriodStart, got.PeriodEnd)
	}
	if got.PastDue() || got.Open != nil {
		t.Fatalf("renewal left the Org past due: %+v", got)
	}
	change := transitions[0].Invoice
	if change == nil || change.Op != InvoiceCreate ||
		change.Invoice.State != subscriptionspec.InvoicePaid ||
		change.Invoice.Reason != subscriptionspec.ReasonRenewal ||
		!change.Invoice.PeriodStart.Equal(got.PeriodStart) ||
		!change.Invoice.PaidAt.Equal(at) ||
		transitions[0].PeriodsAdvanced != 1 || transitions[0].PaymentFailed() {
		t.Fatalf("invoice = %+v", change)
	}
}

func TestAdvanceCatchesUpOnePeriodAtATime(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	got, transitions := Advance(state, date(2027, time.April, 15, 0), testConfig, alwaysPaid)
	assertKinds(t, transitions, KindRenewed, KindRenewed, KindRenewed)
	if !got.PeriodStart.Equal(date(2027, time.April, 1, 0)) ||
		!got.PeriodEnd.Equal(date(2027, time.May, 1, 0)) {
		t.Fatalf("period = %v..%v", got.PeriodStart, got.PeriodEnd)
	}
}

func TestAdvanceBoundsWorkAfterALongOutage(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	_, transitions := Advance(state, date(2040, time.January, 1, 0), testConfig, alwaysPaid)
	if len(transitions) != maxSteps {
		t.Fatalf("steps = %d, want %d", len(transitions), maxSteps)
	}
}

func TestAdvanceOpensAnInvoiceOnAFailedRenewal(t *testing.T) {
	t.Parallel()
	for name, charger := range map[string]Charger{
		"declined": alwaysDeclined, "no method": noMethod,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			state := monthlySilver()
			at := state.PeriodEnd.Add(time.Hour)
			got, transitions := Advance(state, at, testConfig, charger)
			assertKinds(t, transitions, KindRenewalFailed)
			if !got.PastDue() || got.Open == nil || got.Plan != state.Plan {
				t.Fatalf("state = %+v", got)
			}
			open := got.Open
			if open.State != subscriptionspec.InvoiceOpen ||
				!open.DueAt.Equal(state.PeriodEnd.Add(14*24*time.Hour)) ||
				open.AttemptCount != 1 ||
				!open.NextAttemptAt.Equal(state.PeriodEnd.Add(72*time.Hour)) {
				t.Fatalf("open invoice = %+v", open)
			}
			wantFailure := subscriptionspec.FailureDeclined
			if name == "no method" {
				wantFailure = subscriptionspec.FailureNoPaymentMethod
			}
			if open.LastFailure != wantFailure {
				t.Fatalf("failure = %v, want %v", open.LastFailure, wantFailure)
			}
			// The period moved on, so a later payment leaves it unchanged.
			if !got.PeriodStart.Equal(state.PeriodEnd) {
				t.Fatalf("period start = %v", got.PeriodStart)
			}
			if !transitions[0].PaymentFailed() {
				t.Fatal("a failed renewal must report PaymentFailed")
			}
		})
	}
}

func TestAdvanceStopsRenewingWhilePastDue(t *testing.T) {
	t.Parallel()
	state := pastDue()
	// Past the next period end but before the deadline: nothing is charged or
	// advanced except what dunning asks for.
	got, transitions := Advance(state, date(2027, time.February, 3, 0), testConfig, alwaysPaid)
	if len(transitions) != 0 || !got.PastDue() {
		t.Fatalf("Advance() = %+v, %v", got, kinds(transitions))
	}
}

func TestAdvanceRetriesOnSchedule(t *testing.T) {
	t.Parallel()
	state := pastDue()
	// First retry (+3 days) declines; the next is at +7 days.
	got, transitions := Advance(state, date(2027, time.February, 4, 1), testConfig, alwaysDeclined)
	assertKinds(t, transitions, KindRetryFailed)
	if got.Open.AttemptCount != 2 ||
		!got.Open.NextAttemptAt.Equal(date(2027, time.February, 8, 0)) {
		t.Fatalf("open = %+v", got.Open)
	}
	if transitions[0].Invoice.Op != InvoiceRecordFailure || !transitions[0].PaymentFailed() {
		t.Fatalf("transition = %+v", transitions[0])
	}

	// +7 days: declines again; the last is at +11 days.
	got, transitions = Advance(got, date(2027, time.February, 8, 0), testConfig, noMethod)
	assertKinds(t, transitions, KindRetryFailed)
	if got.Open.AttemptCount != 3 ||
		!got.Open.NextAttemptAt.Equal(date(2027, time.February, 12, 0)) ||
		got.Open.LastFailure != subscriptionspec.FailureNoPaymentMethod {
		t.Fatalf("open = %+v", got.Open)
	}

	// +11 days: the last retry; none remain.
	got, transitions = Advance(got, date(2027, time.February, 12, 0), testConfig, alwaysDeclined)
	assertKinds(t, transitions, KindRetryFailed)
	if got.Open.AttemptCount != 4 || !got.Open.NextAttemptAt.IsZero() {
		t.Fatalf("open = %+v", got.Open)
	}
	again, transitions := Advance(got, date(2027, time.February, 13, 0), testConfig, alwaysPaid)
	if len(transitions) != 0 || again.Open.AttemptCount != 4 {
		t.Fatalf("a retry ran with none left: %v", kinds(transitions))
	}
}

func TestAdvanceSkipsRetriesASleepingWorkerMissed(t *testing.T) {
	t.Parallel()
	state := pastDue()
	got, transitions := Advance(state, date(2027, time.February, 9, 0), testConfig, alwaysDeclined)
	assertKinds(t, transitions, KindRetryFailed)
	// +3 and +7 days are both behind now, so one charge covers them and the
	// next is +11 days.
	if !got.Open.NextAttemptAt.Equal(date(2027, time.February, 12, 0)) {
		t.Fatalf("next attempt = %v", got.Open.NextAttemptAt)
	}
}

func TestAdvanceRetrySucceededReturnsToCurrent(t *testing.T) {
	t.Parallel()
	state := pastDue()
	at := date(2027, time.February, 4, 0)
	got, transitions := Advance(state, at, testConfig, alwaysPaid)
	assertKinds(t, transitions, KindRetrySucceeded)
	if got.PastDue() || got.Open != nil ||
		!got.PeriodStart.Equal(state.PeriodStart) || !got.PeriodEnd.Equal(state.PeriodEnd) {
		t.Fatalf("state = %+v", got)
	}
	change := transitions[0].Invoice
	if change.Op != InvoicePay || change.Invoice.State != subscriptionspec.InvoicePaid ||
		!change.Invoice.PaidAt.Equal(at) {
		t.Fatalf("invoice = %+v", change)
	}
}

func TestAdvanceEnforcesTheDeadline(t *testing.T) {
	t.Parallel()
	state := pastDue()
	state.ScheduledPlan = subscriptionspec.FreeTier
	for name, at := range map[string]time.Time{
		"exactly": state.Open.DueAt,
		"after":   state.Open.DueAt.Add(48 * time.Hour),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			got, transitions := Advance(state, at, testConfig, alwaysPaid)
			assertKinds(t, transitions, KindDeadlineEnforced)
			if got.Plan != subscriptionspec.FreeTier || got.PastDue() ||
				got.Open != nil || got.HasSchedule() ||
				!got.AnchorAt.IsZero() || got.Interval != "" {
				t.Fatalf("state = %+v", got)
			}
			if got.PaymentMethod != state.PaymentMethod {
				t.Fatal("the saved payment method must survive the drop to Free")
			}
			change := transitions[0].Invoice
			if change.Op != InvoiceVoid || change.Invoice.State != subscriptionspec.InvoiceVoid {
				t.Fatalf("invoice = %+v", change)
			}
		})
	}
	before, transitions := Advance(state, state.Open.DueAt.Add(-time.Microsecond), testConfig, alwaysDeclined)
	if len(transitions) == 0 && !before.PastDue() {
		t.Fatal("the Org left past due before the deadline")
	}
}

func TestAdvanceAppliesAScheduledCancellation(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	state.ScheduledPlan = subscriptionspec.FreeTier
	got, transitions := Advance(state, state.PeriodEnd, testConfig, alwaysDeclined)
	assertKinds(t, transitions, KindScheduledChangeApplied)
	if got.Plan != subscriptionspec.FreeTier || got.HasSchedule() ||
		got.PastDue() || transitions[0].Invoice != nil {
		t.Fatalf("state = %+v", got)
	}
	// Free has no period, so nothing renews afterwards.
	_, more := Advance(got, date(2040, 1, 1, 0), testConfig, alwaysPaid)
	if len(more) != 0 {
		t.Fatalf("free renewed: %v", kinds(more))
	}
}

func TestAdvanceAppliesAScheduledDowngradeAndChargesTheNewPlan(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	state.Plan = subscriptionspec.GoldTier
	state.ScheduledPlan = subscriptionspec.SilverTier
	state.ScheduledInterval = subscriptionspec.Year
	got, transitions := Advance(state, state.PeriodEnd.Add(time.Minute), testConfig, alwaysPaid)
	assertKinds(t, transitions, KindScheduledChangeApplied)
	if got.Plan != subscriptionspec.SilverTier || got.Interval != subscriptionspec.Year ||
		!got.AnchorAt.Equal(state.PeriodEnd) || !got.PeriodStart.Equal(state.PeriodEnd) ||
		!got.PeriodEnd.Equal(date(2028, time.February, 1, 0)) || got.HasSchedule() {
		t.Fatalf("state = %+v", got)
	}
	change := transitions[0].Invoice
	if change == nil || change.Invoice.Plan != subscriptionspec.SilverTier ||
		change.Invoice.State != subscriptionspec.InvoicePaid {
		t.Fatalf("invoice = %+v", change)
	}
}

func TestAdvanceScheduledDowngradeWithAFailedChargeIsPastDue(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	state.Plan = subscriptionspec.GoldTier
	state.ScheduledPlan = subscriptionspec.SilverTier
	state.ScheduledInterval = subscriptionspec.Month
	got, transitions := Advance(state, state.PeriodEnd, testConfig, alwaysDeclined)
	assertKinds(t, transitions, KindScheduledChangeApplied)
	if got.Plan != subscriptionspec.SilverTier || !got.PastDue() ||
		got.Open.Plan != subscriptionspec.SilverTier || !transitions[0].PaymentFailed() {
		t.Fatalf("state = %+v", got)
	}
}

func TestAdvanceScheduledChangeThenFurtherRenewals(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	state.ScheduledPlan = subscriptionspec.SilverTier
	state.ScheduledInterval = subscriptionspec.Year
	got, transitions := Advance(state, date(2028, time.March, 1, 0), testConfig, alwaysPaid)
	assertKinds(t, transitions, KindScheduledChangeApplied, KindRenewed)
	if !got.PeriodStart.Equal(date(2028, time.February, 1, 0)) {
		t.Fatalf("period start = %v", got.PeriodStart)
	}
}

func TestPayChargesTheOpenInvoice(t *testing.T) {
	t.Parallel()
	state := pastDue()
	at := date(2027, time.February, 2, 0)

	declined, transition, result := Pay(state, at, alwaysDeclined)
	if result != ChargeDeclined || transition != nil || !declined.PastDue() {
		t.Fatalf("declined Pay() = %+v, %v, %v", declined, transition, result)
	}
	_, _, result = Pay(state, at, noMethod)
	if result != ChargeNoPaymentMethod {
		t.Fatalf("no-method Pay() result = %v", result)
	}

	paid, transition, result := Pay(state, at, alwaysPaid)
	if result != ChargePaid || transition == nil || transition.Kind != KindInvoicePaid ||
		paid.PastDue() || paid.Open != nil ||
		!paid.PeriodEnd.Equal(state.PeriodEnd) ||
		transition.Invoice.Op != InvoicePay || !transition.Invoice.Invoice.PaidAt.Equal(at) {
		t.Fatalf("paid Pay() = %+v, %+v, %v", paid, transition, result)
	}

	current, transition, _ := Pay(monthlySilver(), at, alwaysPaid)
	if transition != nil || current.PastDue() {
		t.Fatal("paying a current Org must change nothing")
	}
}
