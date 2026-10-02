package billing

import (
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

// Outcome classifies what Decide chose. Only Unchanged and Refused write
// nothing.
type Outcome string

const (
	Unchanged              Outcome = "unchanged"
	ScheduledChangeCleared Outcome = "scheduled-change-cleared"
	Upgraded               Outcome = "upgraded"
	ChangeScheduled        Outcome = "change-scheduled"
	Refused                Outcome = "refused"
)

// Refusal says why a requested change was refused. Nothing changes.
type Refusal string

const (
	RefusalPastDue               Refusal = "past-due"
	RefusalSeatLimit             Refusal = "seat-limit"
	RefusalPaymentMethodRequired Refusal = "payment-method-required"
	RefusalPaymentDeclined       Refusal = "payment-declined"
)

// Request is a billing holder's chosen plan and interval. Interval is empty
// for the Free plan. Seats is the count of active users plus unexpired
// invitations at the moment of the decision.
type Request struct {
	Plan     subscriptionspec.Plan
	Interval subscriptionspec.BillingInterval
	Seats    int
}

type Decision struct {
	State      State
	Transition *Transition
	Outcome    Outcome

	// Refusal is set exactly when Outcome is Refused. TargetLimit is the cap
	// of the requested plan, set for RefusalSeatLimit.
	Refusal     Refusal
	TargetLimit int
}

// Decide chooses the effect of a billing holder's plan change. It must run on
// a state Advance has already brought up to now.
//
// An upgrade (a higher rank, or the same plan going monthly to annual) is
// charged at once and starts a new period; if the charge cannot be collected
// the upgrade is refused and nothing changes. A downgrade is scheduled for
// period end, and is refused while the Org has more users than the target
// plan allows. Reselecting the current plan and interval clears a schedule.
// While the Org is past due every change is refused.
func Decide(
	current State, request Request, now time.Time, charger Charger,
) Decision {
	if current.PastDue() {
		return refuse(current, RefusalPastDue)
	}

	if request.Plan == current.Plan && request.Interval == current.Interval {
		if !current.HasSchedule() {
			return Decision{State: current, Outcome: Unchanged}
		}
		cleared := current
		cleared.ScheduledPlan = ""
		cleared.ScheduledInterval = ""
		return Decision{
			State:      cleared,
			Transition: &Transition{Kind: KindScheduledChangeCleared, After: cleared},
			Outcome:    ScheduledChangeCleared,
		}
	}

	if subscriptionspec.IsUpgrade(
		current.Plan, current.Interval, request.Plan, request.Interval,
	) {
		return upgrade(current, request, now, charger)
	}

	if request.Plan == current.ScheduledPlan &&
		request.Interval == current.ScheduledInterval {
		return Decision{State: current, Outcome: Unchanged}
	}

	if limit, _ := subscriptionspec.MaxUsers(request.Plan, false); request.Seats > limit {
		decision := refuse(current, RefusalSeatLimit)
		decision.TargetLimit = limit
		return decision
	}

	scheduled := current
	scheduled.ScheduledPlan = request.Plan
	scheduled.ScheduledInterval = request.Interval
	if request.Plan == subscriptionspec.FreeTier {
		scheduled.ScheduledInterval = ""
	}
	return Decision{
		State:      scheduled,
		Transition: &Transition{Kind: KindChangeScheduled, After: scheduled},
		Outcome:    ChangeScheduled,
	}
}

func upgrade(
	current State, request Request, now time.Time, charger Charger,
) Decision {
	result := charger.Charge(current.PaymentMethod)
	if result == ChargeNoPaymentMethod {
		return refuse(current, RefusalPaymentMethodRequired)
	}
	if result != ChargePaid {
		return refuse(current, RefusalPaymentDeclined)
	}
	at := Instant(now)
	next := State{
		Plan:          request.Plan,
		Interval:      request.Interval,
		AnchorAt:      at,
		PeriodStart:   at,
		PeriodEnd:     Boundary(at, request.Interval, 1),
		Billing:       subscriptionspec.Current,
		PaymentMethod: current.PaymentMethod,
	}
	invoice := Invoice{
		Plan:        next.Plan,
		Interval:    next.Interval,
		PeriodStart: next.PeriodStart,
		PeriodEnd:   next.PeriodEnd,
		Reason:      subscriptionspec.ReasonUpgrade,
		State:       subscriptionspec.InvoicePaid,
		CreatedAt:   at,
		PaidAt:      at,
	}
	return Decision{
		State: next,
		Transition: &Transition{
			Kind: KindUpgraded, After: next,
			Invoice: &InvoiceChange{Op: InvoiceCreate, Invoice: invoice},
		},
		Outcome: Upgraded,
	}
}

func refuse(current State, refusal Refusal) Decision {
	return Decision{State: current, Outcome: Refused, Refusal: refusal}
}
