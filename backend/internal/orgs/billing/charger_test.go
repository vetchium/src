package billing

import (
	"testing"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

func TestSimulatedChargerDependsOnlyOnTheCardKind(t *testing.T) {
	t.Parallel()
	cases := []struct {
		method subscriptionspec.PaymentMethodKind
		want   ChargeResult
	}{
		{subscriptionspec.SimulatedSucceeds, ChargePaid},
		{subscriptionspec.SimulatedDeclines, ChargeDeclined},
		{"", ChargeNoPaymentMethod},
		{"card-4242", ChargeNoPaymentMethod},
	}
	for _, testCase := range cases {
		if got := (SimulatedCharger{}).Charge(testCase.method); got != testCase.want {
			t.Fatalf("Charge(%q) = %v, want %v", testCase.method, got, testCase.want)
		}
	}
}

func TestChargeResultFailure(t *testing.T) {
	t.Parallel()
	if ChargeDeclined.Failure() != subscriptionspec.FailureDeclined {
		t.Fatal("declined maps to the wrong failure")
	}
	if ChargeNoPaymentMethod.Failure() != subscriptionspec.FailureNoPaymentMethod {
		t.Fatal("no payment method maps to the wrong failure")
	}
}
