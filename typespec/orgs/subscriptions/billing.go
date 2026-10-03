package subscriptions

type BillingState string

const (
	Current BillingState = "current"
	PastDue BillingState = "past-due"
)

type InvoiceState string

const (
	InvoicePaid InvoiceState = "paid"
	InvoiceOpen InvoiceState = "open"
	InvoiceVoid InvoiceState = "void"
)

type InvoiceReason string

const (
	ReasonUpgrade InvoiceReason = "upgrade"
	ReasonRenewal InvoiceReason = "renewal"
)

type InvoiceFailure string

const (
	FailureDeclined        InvoiceFailure = "declined"
	FailureNoPaymentMethod InvoiceFailure = "no_payment_method"
)

type PaymentMethodKind string

const (
	SimulatedSucceeds PaymentMethodKind = "simulated-succeeds"
	SimulatedDeclines PaymentMethodKind = "simulated-declines"
)

func IsPaymentMethodKind(value PaymentMethodKind) bool {
	return value == SimulatedSucceeds || value == SimulatedDeclines
}
