package subscriptions

import (
	"slices"
	"testing"
)

func TestPlansOrderAndCopyIndependence(t *testing.T) {
	t.Parallel()
	want := []Plan{FreeTier, SilverTier}
	got := Plans()
	if !slices.Equal(got, want) {
		t.Fatalf("Plans() = %v, want %v", got, want)
	}
	got[0] = "changed"
	if !slices.Equal(Plans(), want) {
		t.Fatal("caller mutated the plan catalog")
	}
}

func TestRanksAreUnique(t *testing.T) {
	t.Parallel()
	seen := map[int]Plan{}
	for _, plan := range Plans() {
		rank := Rank(plan)
		if rank == 0 {
			t.Fatalf("Rank(%v) = 0", plan)
		}
		if other, ok := seen[rank]; ok {
			t.Fatalf("rank %d shared by %v and %v", rank, other, plan)
		}
		seen[rank] = plan
	}
}

func TestPlansAtOrAbove(t *testing.T) {
	t.Parallel()
	cases := []struct {
		minimum Plan
		want    []Plan
	}{
		{FreeTier, []Plan{FreeTier, SilverTier}},
		{SilverTier, []Plan{SilverTier}},
	}
	for _, testCase := range cases {
		got := PlansAtOrAbove(testCase.minimum)
		if !slices.Equal(got, testCase.want) {
			t.Fatalf(
				"PlansAtOrAbove(%v) = %v, want %v",
				testCase.minimum, got, testCase.want,
			)
		}
	}
	got := PlansAtOrAbove(FreeTier)
	got[0] = "changed"
	if !slices.Equal(PlansAtOrAbove(FreeTier), []Plan{FreeTier, SilverTier}) {
		t.Fatal("caller mutated PlansAtOrAbove result")
	}
}

func TestIncludes(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		held     PlanOID
		required Plan
		want     bool
	}{
		{"same plan", PlanOID(FreeTier), FreeTier, true},
		{"higher held", PlanOID(SilverTier), FreeTier, true},
		{"lower held", PlanOID(FreeTier), SilverTier, false},
		{"unknown held", PlanOID("hub-gold-tier"), FreeTier, false},
		{"empty held", PlanOID(""), FreeTier, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := Includes(testCase.held, testCase.required); got != testCase.want {
				t.Fatalf(
					"Includes(%q, %v) = %t, want %t",
					testCase.held, testCase.required, got, testCase.want,
				)
			}
		})
	}
}

func TestRequiresBillingInterval(t *testing.T) {
	t.Parallel()
	if RequiresBillingInterval(FreeTier) {
		t.Fatal("free tier requires a billing interval")
	}
	if !RequiresBillingInterval(SilverTier) {
		t.Fatal("silver tier does not require a billing interval")
	}
}

func TestIsUpgrade(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name         string
		fromPlan     Plan
		fromInterval BillingInterval
		toPlan       Plan
		toInterval   BillingInterval
		want         bool
	}{
		{"free to free", FreeTier, "", FreeTier, "", false},
		{"free to silver monthly", FreeTier, "", SilverTier, Month, true},
		{"free to silver annual", FreeTier, "", SilverTier, Year, true},
		{"silver monthly to free", SilverTier, Month, FreeTier, "", false},
		{"silver monthly to monthly", SilverTier, Month, SilverTier, Month, false},
		{"silver monthly to annual", SilverTier, Month, SilverTier, Year, true},
		{"silver annual to free", SilverTier, Year, FreeTier, "", false},
		{"silver annual to monthly", SilverTier, Year, SilverTier, Month, false},
		{"silver annual to annual", SilverTier, Year, SilverTier, Year, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got := IsUpgrade(
				testCase.fromPlan, testCase.fromInterval,
				testCase.toPlan, testCase.toInterval,
			)
			if got != testCase.want {
				t.Fatalf("IsUpgrade() = %t, want %t", got, testCase.want)
			}
		})
	}
}

func TestIsPlanAndIsBillingInterval(t *testing.T) {
	t.Parallel()
	if !IsPlan(PlanOID(FreeTier)) || !IsPlan(PlanOID(SilverTier)) {
		t.Fatal("defined plans rejected")
	}
	if IsPlan(PlanOID("hub-gold-tier")) || IsPlan(PlanOID("")) {
		t.Fatal("unknown plan accepted")
	}
	if !IsBillingInterval(Month) || !IsBillingInterval(Year) {
		t.Fatal("defined intervals rejected")
	}
	if IsBillingInterval("week") || IsBillingInterval("") {
		t.Fatal("unknown interval accepted")
	}
}
