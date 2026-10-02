package billing

import (
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

// TransitionKind names a system-driven or user-driven subscription change.
// The value is the audit action suffix appended to "org.subscription.".
type TransitionKind string

const (
	KindUpgraded               TransitionKind = "upgraded"
	KindChangeScheduled        TransitionKind = "change-scheduled"
	KindScheduledChangeCleared TransitionKind = "scheduled-change-cleared"
	KindScheduledChangeApplied TransitionKind = "scheduled-change-applied"
	KindRenewed                TransitionKind = "renewed"
	KindRenewalFailed          TransitionKind = "renewal-failed"
	KindRetrySucceeded         TransitionKind = "retry-succeeded"
	KindRetryFailed            TransitionKind = "retry-failed"
	KindInvoicePaid            TransitionKind = "invoice-paid"
	KindDeadlineEnforced       TransitionKind = "deadline-enforced"
)

// InvoiceOp is the one write a transition makes to the invoice table.
type InvoiceOp string

const (
	InvoiceCreate        InvoiceOp = "create"
	InvoicePay           InvoiceOp = "pay"
	InvoiceRecordFailure InvoiceOp = "record-failure"
	InvoiceVoid          InvoiceOp = "void"
)

// InvoiceChange carries the invoice as it must be after the write.
type InvoiceChange struct {
	Op      InvoiceOp
	Invoice Invoice
}

// Transition is one state change, ready to become one audit event. Chaining
// several transitions from a starting State reproduces every intermediate
// state a batch save writes in the same statement.
type Transition struct {
	Kind  TransitionKind
	After State

	// Invoice is the invoice write, if the transition makes one.
	Invoice *InvoiceChange

	// PeriodsAdvanced is set only for KindRenewed.
	PeriodsAdvanced int
}

// PaymentFailed reports whether the transition records a failed charge, which
// is when billing holders are told.
func (t Transition) PaymentFailed() bool {
	if t.Invoice == nil {
		return false
	}
	return t.Kind == KindRenewalFailed || t.Kind == KindRetryFailed ||
		(t.Kind == KindScheduledChangeApplied &&
			t.Invoice.Invoice.State == subscriptionspec.InvoiceOpen)
}

// Config times the dunning lifecycle. Every retry offset lies inside
// GracePeriod; appconfig enforces that.
type Config struct {
	// GracePeriod is how long service continues after a failed renewal.
	GracePeriod time.Duration
	// RetryOffsets, ascending, are the delays after the failure at which the
	// saved method is charged again.
	RetryOffsets []time.Duration
}

// maxSteps bounds the work one call does after a long outage. Anything left
// is picked up by the next call.
const maxSteps = 36

// Advance applies every transition that is due at now: renewals and scheduled
// changes at period end, retries of a failed renewal, and the deadline that
// ends the grace period. The worker, set-plan before Decide, and pay-invoice
// all call it; a read computes it in memory and writes nothing.
func Advance(
	state State, now time.Time, cfg Config, charger Charger,
) (State, []Transition) {
	var transitions []Transition
	for range maxSteps {
		next, step := advanceOnce(state, now, cfg, charger)
		if step == nil {
			break
		}
		state = next
		transitions = append(transitions, *step)
	}
	return state, transitions
}

func advanceOnce(
	state State, now time.Time, cfg Config, charger Charger,
) (State, *Transition) {
	if state.Plan == subscriptionspec.FreeTier {
		return state, nil
	}
	if state.PastDue() {
		return advancePastDue(state, now, cfg, charger)
	}
	// Also covers `now` before the period start, which absorbs clock skew
	// between hosts.
	if now.Before(state.PeriodEnd) {
		return state, nil
	}
	boundary := state.PeriodEnd
	if state.HasSchedule() {
		return applySchedule(state, boundary, now, cfg, charger)
	}
	start, end := PeriodContaining(state.AnchorAt, state.Interval, boundary)
	next := state
	next.PeriodStart, next.PeriodEnd = start, end
	return charge(next, boundary, now, cfg, charger, subscriptionspec.ReasonRenewal,
		KindRenewed, KindRenewalFailed)
}

// applySchedule starts the scheduled plan at the boundary. A paid target is
// charged for its first period; Free is not.
func applySchedule(
	state State, boundary, now time.Time, cfg Config, charger Charger,
) (State, *Transition) {
	applied := State{
		Plan:          state.ScheduledPlan,
		Billing:       subscriptionspec.Current,
		PaymentMethod: state.PaymentMethod,
	}
	if applied.Plan == subscriptionspec.FreeTier {
		return applied, &Transition{Kind: KindScheduledChangeApplied, After: applied}
	}
	applied.Interval = state.ScheduledInterval
	applied.AnchorAt = boundary
	applied.PeriodStart = Boundary(boundary, applied.Interval, 0)
	applied.PeriodEnd = Boundary(boundary, applied.Interval, 1)
	return charge(applied, boundary, now, cfg, charger,
		subscriptionspec.ReasonRenewal,
		KindScheduledChangeApplied, KindScheduledChangeApplied)
}

// charge bills the period `next` starts. A paid charge records a paid invoice;
// a failure opens one and makes the Org past due, with service continuing on
// the paid plan through the grace period.
func charge(
	next State, failedAt, now time.Time, cfg Config, charger Charger,
	reason subscriptionspec.InvoiceReason, paidKind, failedKind TransitionKind,
) (State, *Transition) {
	invoice := Invoice{
		Plan:        next.Plan,
		Interval:    next.Interval,
		PeriodStart: next.PeriodStart,
		PeriodEnd:   next.PeriodEnd,
		Reason:      reason,
	}
	result := charger.Charge(next.PaymentMethod)
	if result == ChargePaid {
		invoice.State = subscriptionspec.InvoicePaid
		invoice.PaidAt = Instant(now)
		transition := &Transition{
			Kind: paidKind, After: next,
			Invoice: &InvoiceChange{Op: InvoiceCreate, Invoice: invoice},
		}
		if paidKind == KindRenewed {
			transition.PeriodsAdvanced = 1
		}
		return next, transition
	}
	invoice.State = subscriptionspec.InvoiceOpen
	invoice.DueAt = Instant(failedAt.Add(cfg.GracePeriod))
	invoice.AttemptCount = 1
	invoice.NextAttemptAt = nextAttempt(failedAt, 1, now, cfg)
	invoice.LastFailure = result.Failure()
	next.Billing = subscriptionspec.PastDue
	next.Open = &invoice
	return next, &Transition{
		Kind: failedKind, After: next,
		Invoice: &InvoiceChange{Op: InvoiceCreate, Invoice: invoice},
	}
}

// nextAttempt is the first scheduled retry after `attempts` charges that is
// still ahead of now. A retry the worker slept through is skipped, not
// replayed in a burst. The zero time means no retry remains.
func nextAttempt(
	failedAt time.Time, attempts int, now time.Time, cfg Config,
) time.Time {
	for index := attempts - 1; index < len(cfg.RetryOffsets); index++ {
		at := failedAt.Add(cfg.RetryOffsets[index])
		if at.After(now) {
			return Instant(at)
		}
	}
	return time.Time{}
}

func advancePastDue(
	state State, now time.Time, cfg Config, charger Charger,
) (State, *Transition) {
	open := *state.Open
	if !now.Before(open.DueAt) {
		ended := State{
			Plan:          subscriptionspec.FreeTier,
			Billing:       subscriptionspec.Current,
			PaymentMethod: state.PaymentMethod,
		}
		open.State = subscriptionspec.InvoiceVoid
		open.NextAttemptAt = time.Time{}
		return ended, &Transition{
			Kind: KindDeadlineEnforced, After: ended,
			Invoice: &InvoiceChange{Op: InvoiceVoid, Invoice: open},
		}
	}
	if open.NextAttemptAt.IsZero() || now.Before(open.NextAttemptAt) {
		return state, nil
	}
	result := charger.Charge(state.PaymentMethod)
	if result == ChargePaid {
		return settle(state, open, now, KindRetrySucceeded)
	}
	open.AttemptCount++
	open.LastFailure = result.Failure()
	open.NextAttemptAt = nextAttempt(open.PeriodStart, open.AttemptCount, now, cfg)
	next := state
	next.Open = &open
	return next, &Transition{
		Kind: KindRetryFailed, After: next,
		Invoice: &InvoiceChange{Op: InvoiceRecordFailure, Invoice: open},
	}
}

// settle marks the open invoice paid and returns the Org to current billing,
// leaving its period as it was.
func settle(
	state State, open Invoice, now time.Time, kind TransitionKind,
) (State, *Transition) {
	open.State = subscriptionspec.InvoicePaid
	open.PaidAt = Instant(now)
	open.DueAt = time.Time{}
	open.NextAttemptAt = time.Time{}
	next := state
	next.Billing = subscriptionspec.Current
	next.Open = nil
	return next, &Transition{
		Kind: kind, After: next,
		Invoice: &InvoiceChange{Op: InvoicePay, Invoice: open},
	}
}

// Pay charges the saved method for the open invoice at the request of a
// billing holder. It returns the new state and transition when the charge
// succeeds, and the failed result otherwise, in which case nothing changes.
func Pay(
	state State, now time.Time, charger Charger,
) (State, *Transition, ChargeResult) {
	if !state.PastDue() {
		return state, nil, ChargePaid
	}
	result := charger.Charge(state.PaymentMethod)
	if result != ChargePaid {
		return state, nil, result
	}
	next, transition := settle(state, *state.Open, now, KindInvoicePaid)
	return next, transition, ChargePaid
}
