package subscriptions

import (
	"slices"
	"testing"
)

func TestPlansOrderAndCopyIndependence(t *testing.T) {
	t.Parallel()
	want := []Plan{FreeTier, SilverTier, GoldTier}
	got := Plans()
	if !slices.Equal(got, want) {
		t.Fatalf("Plans() = %v, want %v", got, want)
	}
	got[0] = "changed"
	if !slices.Equal(Plans(), want) {
		t.Fatal("caller mutated the plan catalog")
	}
}

func TestRanksAreUniqueAndAscending(t *testing.T) {
	t.Parallel()
	previous := 0
	for _, plan := range Plans() {
		rank := Rank(plan)
		if rank <= previous {
			t.Fatalf("Rank(%v) = %d, not above %d", plan, rank, previous)
		}
		previous = rank
	}
}

func TestPlansAtOrAbove(t *testing.T) {
	t.Parallel()
	cases := []struct {
		minimum Plan
		want    []Plan
	}{
		{FreeTier, []Plan{FreeTier, SilverTier, GoldTier}},
		{SilverTier, []Plan{SilverTier, GoldTier}},
		{GoldTier, []Plan{GoldTier}},
	}
	for _, testCase := range cases {
		got := PlansAtOrAbove(testCase.minimum)
		if !slices.Equal(got, testCase.want) {
			t.Fatalf("PlansAtOrAbove(%v) = %v, want %v",
				testCase.minimum, got, testCase.want)
		}
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
		{"same plan", PlanOID(GoldTier), GoldTier, true},
		{"higher held", PlanOID(GoldTier), SilverTier, true},
		{"lower held", PlanOID(SilverTier), GoldTier, false},
		{"unknown held", PlanOID("org-platinum-tier"), FreeTier, false},
		{"empty held", PlanOID(""), FreeTier, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got := Includes(testCase.held, testCase.required)
			if got != testCase.want {
				t.Fatalf("Includes(%q, %v) = %t, want %t",
					testCase.held, testCase.required, got, testCase.want)
			}
		})
	}
}

func TestRequiresBillingInterval(t *testing.T) {
	t.Parallel()
	if RequiresBillingInterval(FreeTier) {
		t.Fatal("free tier requires a billing interval")
	}
	if !RequiresBillingInterval(SilverTier) || !RequiresBillingInterval(GoldTier) {
		t.Fatal("paid tier does not require a billing interval")
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
		{"free to silver", FreeTier, "", SilverTier, Month, true},
		{"silver to gold", SilverTier, Year, GoldTier, Month, true},
		{"gold to silver", GoldTier, Month, SilverTier, Year, false},
		{"gold to free", GoldTier, Year, FreeTier, "", false},
		{"monthly to annual", GoldTier, Month, GoldTier, Year, true},
		{"annual to monthly", GoldTier, Year, GoldTier, Month, false},
		{"same", SilverTier, Month, SilverTier, Month, false},
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
	for _, plan := range Plans() {
		if !IsPlan(PlanOID(plan)) {
			t.Fatalf("defined plan %v rejected", plan)
		}
	}
	if IsPlan("org-platinum-tier") || IsPlan("hub-free-tier") || IsPlan("") {
		t.Fatal("unknown plan accepted")
	}
	if !IsBillingInterval(Month) || !IsBillingInterval(Year) {
		t.Fatal("defined intervals rejected")
	}
	if IsBillingInterval("week") || IsBillingInterval("") {
		t.Fatal("unknown interval accepted")
	}
}

func TestMaxUsers(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name          string
		plan          Plan
		google        bool
		wantLimit     int
		wantUnlimited bool
	}{
		{"free", FreeTier, false, 5, false},
		{"free ignores google", FreeTier, true, 5, false},
		{"silver", SilverTier, false, 50, false},
		{"silver ignores google", SilverTier, true, 50, false},
		{"gold", GoldTier, false, 1000, false},
		{"gold with google", GoldTier, true, 0, true},
		{"unknown", "org-platinum-tier", true, 0, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			limit, unlimited := MaxUsers(testCase.plan, testCase.google)
			if limit != testCase.wantLimit || unlimited != testCase.wantUnlimited {
				t.Fatalf("MaxUsers() = %d, %t, want %d, %t", limit, unlimited,
					testCase.wantLimit, testCase.wantUnlimited)
			}
		})
	}
}

func TestEntitlementsGrowWithRank(t *testing.T) {
	t.Parallel()
	wantOpenings := map[Plan]int{FreeTier: 25, SilverTier: 250, GoldTier: 2500}
	for plan, want := range wantOpenings {
		if got := OpeningsPerYear(plan); got != want {
			t.Fatalf("OpeningsPerYear(%v) = %d, want %d", plan, got, want)
		}
	}
	if AllowsLogo(FreeTier) || !AllowsLogo(SilverTier) || !AllowsLogo(GoldTier) {
		t.Fatal("logo must be Silver and above")
	}
	if AllowsGoogleSignIn(SilverTier) || !AllowsGoogleSignIn(GoldTier) {
		t.Fatal("Google sign-in must be Gold only")
	}
	if IncludesTicketSupport(SilverTier) || !IncludesTicketSupport(GoldTier) {
		t.Fatal("ticket support must be Gold only")
	}
	if AllowsLogo("org-platinum-tier") || OpeningsPerYear("") != 0 {
		t.Fatal("unknown plan must have no entitlements")
	}
}
