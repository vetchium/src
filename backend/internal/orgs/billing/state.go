// Package billing is the pure, database-free domain package for Org
// subscriptions: period-end advancement, dunning, plan-change decisions, the
// set of users kept when an Org drops to Free, and warning selection. It owns
// no HTTP or SQL behavior; the worker and the handlers persist what it
// decides.
package billing

import (
	"fmt"
	"time"

	"backend/internal/billingperiod"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

// Instant truncates to the precision timestamptz stores, and converts to UTC,
// so a state built from decided values equals the one read back.
func Instant(t time.Time) time.Time { return billingperiod.Instant(t) }

func intervalMonths(interval subscriptionspec.BillingInterval) int {
	if interval == subscriptionspec.Year {
		return 12
	}
	return 1
}

// Boundary adds n billing intervals to anchor; see billingperiod.Boundary.
func Boundary(
	anchor time.Time, interval subscriptionspec.BillingInterval, n int,
) time.Time {
	return billingperiod.Boundary(anchor, intervalMonths(interval), n)
}

// PeriodContaining returns the period for the largest n >= 0 with
// Boundary(n) <= at.
func PeriodContaining(
	anchor time.Time, interval subscriptionspec.BillingInterval, at time.Time,
) (time.Time, time.Time) {
	return billingperiod.PeriodContaining(anchor, intervalMonths(interval), at)
}

// Invoice is a charge for one period. Open is the only state that is not
// final: it is what makes an Org past due.
type Invoice struct {
	// ID is empty until the invoice is persisted.
	ID string

	Plan        subscriptionspec.Plan
	Interval    subscriptionspec.BillingInterval
	PeriodStart time.Time
	PeriodEnd   time.Time
	Reason      subscriptionspec.InvoiceReason
	State       subscriptionspec.InvoiceState

	// DueAt, NextAttemptAt, and LastFailure are set only while open.
	// NextAttemptAt is the zero time when no retry remains.
	DueAt         time.Time
	AttemptCount  int
	NextAttemptAt time.Time
	LastFailure   subscriptionspec.InvoiceFailure

	CreatedAt time.Time
	PaidAt    time.Time
	VoidedAt  time.Time
}

// Stored is the database-free input to StateFromStored. Interval and
// ScheduledInterval are empty when the corresponding column is null.
type Stored struct {
	OrgDID string

	PlanOID  string
	Interval string

	AnchorAt    *time.Time
	PeriodStart *time.Time
	PeriodEnd   *time.Time

	ScheduledPlanOID  string
	ScheduledInterval string

	PastDue       bool
	PaymentMethod string

	// OpenInvoice is the Org's open invoice, if any.
	OpenInvoice *Invoice
}

type State struct {
	Plan     subscriptionspec.Plan
	Interval subscriptionspec.BillingInterval

	AnchorAt    time.Time
	PeriodStart time.Time
	PeriodEnd   time.Time

	ScheduledPlan     subscriptionspec.Plan
	ScheduledInterval subscriptionspec.BillingInterval

	Billing subscriptionspec.BillingState

	// PaymentMethod is empty when the Org has none saved.
	PaymentMethod subscriptionspec.PaymentMethodKind

	// Open is non-nil exactly while Billing is past due.
	Open *Invoice
}

func (s State) HasSchedule() bool { return s.ScheduledPlan != "" }

func (s State) PastDue() bool { return s.Billing == subscriptionspec.PastDue }

// StateFromStored validates a database row into a State. It rejects a plan
// the contract does not define, a paid state whose period is not a boundary
// pair of its anchor, and a billing state that disagrees with the open
// invoice.
func StateFromStored(stored Stored) (State, error) {
	plan := subscriptionspec.Plan(stored.PlanOID)
	if !subscriptionspec.IsPlan(subscriptionspec.PlanOID(plan)) {
		return State{}, fmt.Errorf(
			"org %s: unknown plan %q", stored.OrgDID, stored.PlanOID,
		)
	}

	state := State{Plan: plan, Billing: subscriptionspec.Current}
	if plan != subscriptionspec.FreeTier {
		if stored.AnchorAt == nil || stored.PeriodStart == nil ||
			stored.PeriodEnd == nil {
			return State{}, fmt.Errorf(
				"org %s: paid plan %q has no period", stored.OrgDID, stored.PlanOID,
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
				"org %s: period is not a boundary pair of its anchor",
				stored.OrgDID,
			)
		}
	}

	if stored.ScheduledPlanOID != "" {
		scheduledPlan := subscriptionspec.Plan(stored.ScheduledPlanOID)
		if !subscriptionspec.IsPlan(subscriptionspec.PlanOID(scheduledPlan)) {
			return State{}, fmt.Errorf(
				"org %s: unknown scheduled plan %q",
				stored.OrgDID, stored.ScheduledPlanOID,
			)
		}
		state.ScheduledPlan = scheduledPlan
		state.ScheduledInterval = subscriptionspec.BillingInterval(
			stored.ScheduledInterval,
		)
	}

	if stored.PaymentMethod != "" {
		method := subscriptionspec.PaymentMethodKind(stored.PaymentMethod)
		if !subscriptionspec.IsPaymentMethodKind(method) {
			return State{}, fmt.Errorf(
				"org %s: unknown payment method %q",
				stored.OrgDID, stored.PaymentMethod,
			)
		}
		state.PaymentMethod = method
	}

	if stored.PastDue != (stored.OpenInvoice != nil) {
		return State{}, fmt.Errorf(
			"org %s: past due disagrees with its open invoice", stored.OrgDID,
		)
	}
	if stored.PastDue {
		if plan == subscriptionspec.FreeTier {
			return State{}, fmt.Errorf("org %s: free plan is past due", stored.OrgDID)
		}
		state.Billing = subscriptionspec.PastDue
		open := *stored.OpenInvoice
		open.PeriodStart = Instant(open.PeriodStart)
		open.PeriodEnd = Instant(open.PeriodEnd)
		open.DueAt = Instant(open.DueAt)
		if !open.NextAttemptAt.IsZero() {
			open.NextAttemptAt = Instant(open.NextAttemptAt)
		}
		state.Open = &open
	}
	return state, nil
}
