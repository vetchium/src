// Package subscriptions contains Hub subscription plan and billing wire
// types.
package subscriptions

import "slices"

type Plan string
type PlanOID string
type BillingInterval string

const (
	FreeTier   Plan = "hub-free-tier"
	SilverTier Plan = "hub-silver-tier"
)

const (
	Month BillingInterval = "month"
	Year  BillingInterval = "year"
)

// DefaultPlan is both the signup plan and the downgrade target.
const DefaultPlan = FreeTier

// plans is ordered by ascending rank, the way portals present plans.
var plans = []Plan{FreeTier, SilverTier}

var planRanks = map[Plan]int{
	FreeTier:   1000,
	SilverTier: 2000,
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
