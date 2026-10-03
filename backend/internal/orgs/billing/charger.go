package billing

import subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

// ChargeResult is what a charge attempt came to.
type ChargeResult string

const (
	ChargePaid            ChargeResult = "paid"
	ChargeDeclined        ChargeResult = "declined"
	ChargeNoPaymentMethod ChargeResult = "no-payment-method"
)

// Charger collects payment from a saved payment method. A real processor
// would replace SimulatedCharger without touching the rules that call it.
type Charger interface {
	Charge(method subscriptionspec.PaymentMethodKind) ChargeResult
}

// SimulatedCharger decides from the kind of the saved test card alone, the
// same way in every environment.
type SimulatedCharger struct{}

func (SimulatedCharger) Charge(
	method subscriptionspec.PaymentMethodKind,
) ChargeResult {
	switch method {
	case subscriptionspec.SimulatedSucceeds:
		return ChargePaid
	case subscriptionspec.SimulatedDeclines:
		return ChargeDeclined
	default:
		return ChargeNoPaymentMethod
	}
}

// Failure maps a failed charge to the reason an invoice records. It is
// meaningful only for a result other than ChargePaid.
func (r ChargeResult) Failure() subscriptionspec.InvoiceFailure {
	if r == ChargeNoPaymentMethod {
		return subscriptionspec.FailureNoPaymentMethod
	}
	return subscriptionspec.FailureDeclined
}
