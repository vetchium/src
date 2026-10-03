// Package subscriptions contains Org subscription plan and billing wire
// types.
package subscriptions

import "slices"

type Plan string
type PlanOID string
type BillingInterval string

const (
	FreeTier   Plan = "org-free-tier"
	SilverTier Plan = "org-silver-tier"
	GoldTier   Plan = "org-gold-tier"
)

const (
	Month BillingInterval = "month"
	Year  BillingInterval = "year"
)

// DefaultPlan is both the signup plan and the downgrade target.
const DefaultPlan = FreeTier

// plans is ordered by ascending rank, the way portals present plans.
var plans = []Plan{FreeTier, SilverTier, GoldTier}

var planRanks = map[Plan]int{
	FreeTier:   1000,
	SilverTier: 2000,
	GoldTier:   3000,
}

// Entitlements is what one plan allows. MaxUsersWithGoogleSignIn is nil when
// the cap is lifted while the Org has Google sign-in enabled.
type Entitlements struct {
	MaxUsers                 int
	MaxUsersWithGoogleSignIn *int
	OpeningsPerYear          int
	AllowsLogo               bool
	AllowsGoogleSignIn       bool
	IncludesTicketSupport    bool
}

func intPtr(value int) *int { return &value }

var entitlements = map[Plan]Entitlements{
	FreeTier: {
		MaxUsers: 5, MaxUsersWithGoogleSignIn: intPtr(5),
		OpeningsPerYear: 25,
	},
	SilverTier: {
		MaxUsers: 50, MaxUsersWithGoogleSignIn: intPtr(50),
		OpeningsPerYear: 250, AllowsLogo: true,
	},
	GoldTier: {
		MaxUsers: 1000, MaxUsersWithGoogleSignIn: nil,
		OpeningsPerYear: 2500, AllowsLogo: true,
		AllowsGoogleSignIn: true, IncludesTicketSupport: true,
	},
}

// Plans returns every plan this contract version defines, in ascending rank
// order.
func Plans() []Plan {
	return slices.Clone(plans)
}

func IsPlan(value PlanOID) bool {
	return slices.Contains(plans, Plan(value))
}

func IsBillingInterval(value BillingInterval) bool {
	return value == Month || value == Year
}

// Rank returns 0 for a plan this contract version does not define.
func Rank(plan Plan) int {
	return planRanks[plan]
}

func PlansAtOrAbove(minimum Plan) []Plan {
	result := make([]Plan, 0, len(plans))
	for _, plan := range plans {
		if Rank(plan) >= Rank(minimum) {
			result = append(result, plan)
		}
	}
	return result
}

// Includes reports whether the plan held is at or above required. An unknown
// held plan never includes anything.
func Includes(held PlanOID, required Plan) bool {
	if !IsPlan(held) {
		return false
	}
	return Rank(Plan(held)) >= Rank(required)
}

func RequiresBillingInterval(plan Plan) bool {
	return plan != FreeTier
}

// IsUpgrade is the single statement of the upgrade rule: a higher plan rank,
// or the same plan moving from a monthly to an annual interval. An empty
// interval stands for the free plan, which has none.
func IsUpgrade(
	fromPlan Plan, fromInterval BillingInterval,
	toPlan Plan, toInterval BillingInterval,
) bool {
	if Rank(toPlan) != Rank(fromPlan) {
		return Rank(toPlan) > Rank(fromPlan)
	}
	return fromInterval == Month && toInterval == Year
}

// MaxUsers returns the seat cap. Only Gold with Google sign-in enabled is
// unlimited; an unknown plan has a cap of zero.
func MaxUsers(plan Plan, googleSignInEnabled bool) (limit int, unlimited bool) {
	held, ok := entitlements[plan]
	if !ok {
		return 0, false
	}
	if googleSignInEnabled && held.AllowsGoogleSignIn {
		if held.MaxUsersWithGoogleSignIn == nil {
			return 0, true
		}
		return *held.MaxUsersWithGoogleSignIn, false
	}
	return held.MaxUsers, false
}

func OpeningsPerYear(plan Plan) int { return entitlements[plan].OpeningsPerYear }

func AllowsLogo(plan Plan) bool { return entitlements[plan].AllowsLogo }

func AllowsGoogleSignIn(plan Plan) bool {
	return entitlements[plan].AllowsGoogleSignIn
}

func IncludesTicketSupport(plan Plan) bool {
	return entitlements[plan].IncludesTicketSupport
}
