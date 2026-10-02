package billing

import (
	"strings"
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

func instants(state State) (*time.Time, *time.Time, *time.Time) {
	return &state.AnchorAt, &state.PeriodStart, &state.PeriodEnd
}

func TestStateFromStored(t *testing.T) {
	t.Parallel()
	paid := monthlySilver()
	anchor, start, end := instants(paid)
	open := *pastDue().Open

	cases := []struct {
		name    string
		stored  Stored
		wantErr string
	}{
		{"free", Stored{PlanOID: "org-free-tier"}, ""},
		{
			"paid", Stored{
				PlanOID: "org-silver-tier", Interval: "month",
				AnchorAt: anchor, PeriodStart: start, PeriodEnd: end,
				PaymentMethod: "simulated-succeeds",
			}, "",
		},
		{
			"paid with schedule", Stored{
				PlanOID: "org-silver-tier", Interval: "month",
				AnchorAt: anchor, PeriodStart: start, PeriodEnd: end,
				ScheduledPlanOID: "org-free-tier",
			}, "",
		},
		{"unknown plan", Stored{PlanOID: "org-platinum-tier"}, "unknown plan"},
		{"hub plan", Stored{PlanOID: "hub-free-tier"}, "unknown plan"},
		{
			"paid without a period",
			Stored{PlanOID: "org-gold-tier", Interval: "month"}, "no period",
		},
		{
			"period off the anchor's boundaries", Stored{
				PlanOID: "org-silver-tier", Interval: "month",
				AnchorAt: anchor, PeriodStart: start,
				PeriodEnd: func() *time.Time { v := end.Add(time.Hour); return &v }(),
			}, "boundary pair",
		},
		{
			"unknown scheduled plan", Stored{
				PlanOID: "org-silver-tier", Interval: "month",
				AnchorAt: anchor, PeriodStart: start, PeriodEnd: end,
				ScheduledPlanOID: "org-platinum-tier",
			}, "unknown scheduled plan",
		},
		{
			"unknown payment method", Stored{
				PlanOID: "org-silver-tier", Interval: "month",
				AnchorAt: anchor, PeriodStart: start, PeriodEnd: end,
				PaymentMethod: "card-4242",
			}, "unknown payment method",
		},
		{
			"past due without an open invoice", Stored{
				PlanOID: "org-silver-tier", Interval: "month",
				AnchorAt: anchor, PeriodStart: start, PeriodEnd: end, PastDue: true,
			}, "disagrees",
		},
		{
			"open invoice without past due", Stored{
				PlanOID: "org-silver-tier", Interval: "month",
				AnchorAt: anchor, PeriodStart: start, PeriodEnd: end,
				OpenInvoice: &open,
			}, "disagrees",
		},
		{
			"past due on the free plan",
			Stored{PlanOID: "org-free-tier", PastDue: true, OpenInvoice: &open},
			"free plan is past due",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			_, err := StateFromStored(testCase.stored)
			if testCase.wantErr == "" {
				if err != nil {
					t.Fatalf("StateFromStored() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), testCase.wantErr) {
				t.Fatalf("StateFromStored() error = %v, want %q", err, testCase.wantErr)
			}
		})
	}
}

func TestStateFromStoredCarriesBillingAndInvoice(t *testing.T) {
	t.Parallel()
	state := pastDue()
	anchor, start, end := instants(state)
	got, err := StateFromStored(Stored{
		PlanOID: "org-silver-tier", Interval: "month",
		AnchorAt: anchor, PeriodStart: start, PeriodEnd: end,
		PaymentMethod: "simulated-declines", PastDue: true, OpenInvoice: state.Open,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !got.PastDue() || got.Open == nil ||
		got.PaymentMethod != subscriptionspec.SimulatedDeclines ||
		!got.Open.DueAt.Equal(state.Open.DueAt) {
		t.Fatalf("StateFromStored() = %+v", got)
	}
}

func TestInstantTruncatesToMicroseconds(t *testing.T) {
	t.Parallel()
	in := time.Date(2027, 1, 1, 0, 0, 0, 123456789, time.FixedZone("x", 3600))
	got := Instant(in)
	if got.Nanosecond() != 123456000 || got.Location() != time.UTC {
		t.Fatalf("Instant() = %v", got)
	}
}
