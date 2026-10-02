package billing

import (
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

func date(year int, month time.Month, day, hour int) time.Time {
	return time.Date(year, month, day, hour, 0, 0, 0, time.UTC)
}

// config is the production shape at a small scale: a 14 day grace period with
// retries at +3, +7, and +11 days.
var testConfig = Config{
	GracePeriod:  14 * 24 * time.Hour,
	RetryOffsets: []time.Duration{72 * time.Hour, 168 * time.Hour, 264 * time.Hour},
}

type fixedCharger struct{ result ChargeResult }

func (c fixedCharger) Charge(subscriptionspec.PaymentMethodKind) ChargeResult {
	return c.result
}

var (
	alwaysPaid     = fixedCharger{ChargePaid}
	alwaysDeclined = fixedCharger{ChargeDeclined}
	noMethod       = fixedCharger{ChargeNoPaymentMethod}
)

// monthlySilver is a Silver subscription paying monthly from Jan 1 2027.
func monthlySilver() State {
	anchor := date(2027, time.January, 1, 0)
	return State{
		Plan:          subscriptionspec.SilverTier,
		Interval:      subscriptionspec.Month,
		AnchorAt:      anchor,
		PeriodStart:   anchor,
		PeriodEnd:     date(2027, time.February, 1, 0),
		Billing:       subscriptionspec.Current,
		PaymentMethod: subscriptionspec.SimulatedSucceeds,
	}
}

func freeState() State {
	return State{Plan: subscriptionspec.FreeTier, Billing: subscriptionspec.Current}
}

// pastDue is monthlySilver whose February renewal failed on Feb 1.
func pastDue() State {
	state := monthlySilver()
	state.PeriodStart = date(2027, time.February, 1, 0)
	state.PeriodEnd = date(2027, time.March, 1, 0)
	state.PaymentMethod = subscriptionspec.SimulatedDeclines
	state.Billing = subscriptionspec.PastDue
	state.Open = &Invoice{
		Plan:          state.Plan,
		Interval:      state.Interval,
		PeriodStart:   state.PeriodStart,
		PeriodEnd:     state.PeriodEnd,
		Reason:        subscriptionspec.ReasonRenewal,
		State:         subscriptionspec.InvoiceOpen,
		DueAt:         date(2027, time.February, 15, 0),
		AttemptCount:  1,
		NextAttemptAt: date(2027, time.February, 4, 0),
		LastFailure:   subscriptionspec.FailureDeclined,
	}
	return state
}
