package subscriptions

import (
	"encoding/json"
	"slices"
	"testing"
)

func decodePlanRequest(t *testing.T, body string) SetSubscriptionPlanRequest {
	t.Helper()
	var request SetSubscriptionPlanRequest
	if err := json.Unmarshal([]byte(body), &request); err != nil {
		t.Fatal(err)
	}
	return request
}

func TestSetSubscriptionPlanRequestValidate(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		body string
		want []string
	}{
		{"free without interval", `{"plan_oid":"org-free-tier"}`, []string{}},
		{"silver monthly", `{"plan_oid":"org-silver-tier","billing_interval":"month"}`, []string{}},
		{"gold annual", `{"plan_oid":"org-gold-tier","billing_interval":"year"}`, []string{}},
		{"unknown plan", `{"plan_oid":"org-platinum-tier"}`, []string{"plan_oid"}},
		{"hub plan", `{"plan_oid":"hub-silver-tier","billing_interval":"month"}`, []string{"plan_oid"}},
		{"free with interval", `{"plan_oid":"org-free-tier","billing_interval":"month"}`, []string{"billing_interval"}},
		{"paid without interval", `{"plan_oid":"org-silver-tier"}`, []string{"billing_interval"}},
		{"unknown interval", `{"plan_oid":"org-silver-tier","billing_interval":"week"}`, []string{"billing_interval"}},
		{"null interval", `{"plan_oid":"org-silver-tier","billing_interval":null}`, []string{"billing_interval"}},
		{"null interval on free", `{"plan_oid":"org-free-tier","billing_interval":null}`, []string{"billing_interval"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got := decodePlanRequest(t, testCase.body).Validate()
			if !slices.Equal(got, testCase.want) {
				t.Fatalf("Validate() = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestOptionalBillingIntervalOmitsWhenAbsent(t *testing.T) {
	t.Parallel()
	encoded, err := json.Marshal(SetSubscriptionPlanRequest{PlanOID: FreeTier})
	if err != nil || string(encoded) != `{"plan_oid":"org-free-tier"}` {
		t.Fatalf("encoded = %s, %v", encoded, err)
	}
}

func TestPaymentAndInvoiceRequests(t *testing.T) {
	t.Parallel()
	if got := (SetPaymentMethodRequest{Kind: SimulatedDeclines}).Validate(); len(got) != 0 {
		t.Fatalf("valid kind = %v", got)
	}
	if got := (SetPaymentMethodRequest{Kind: "visa"}).Validate(); !slices.Equal(got, []string{"kind"}) {
		t.Fatalf("invalid kind = %v", got)
	}
	if got := (PayInvoiceRequest{InvoiceID: "0190a3b2-0000-4000-8000-000000000000"}).Validate(); len(got) != 0 {
		t.Fatalf("valid invoice = %v", got)
	}
	for _, invalid := range []string{"", "nope", "0190A3B2-0000-4000-8000-000000000000", "0190a3b2000040008000000000000000"} {
		if got := (PayInvoiceRequest{InvoiceID: invalid}).Validate(); !slices.Equal(got, []string{"invoice_id"}) {
			t.Fatalf("invoice %q = %v", invalid, got)
		}
	}
	if got := (ListInvoicesRequest{}).Validate(); len(got) != 0 {
		t.Fatalf("defaults = %v", got)
	}
}
