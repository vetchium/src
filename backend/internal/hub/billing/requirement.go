package billing

import (
	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"
)

// AllowedPlanOIDs returns the plan OIDs at or above minimum, ready to pass as
// a sqlc text[] parameter to a gated write's `hub_plan_oid = ANY(...)`
// predicate. This keeps a plan-required decision atomic: nothing can land
// between the check and the write.
//
// A gated statement predicates on the committed hub_users.hub_plan_oid. A due
// scheduled change counts only once the worker or a set-plan request has
// written it. A gated feature that cannot accept that lag must apply due
// transitions first in its own transaction, with Advance and
// SaveHubSubscriptionStates, exactly as set-plan does.
func AllowedPlanOIDs(minimum subscriptionspec.Plan) []string {
	plans := subscriptionspec.PlansAtOrAbove(minimum)
	result := make([]string, 0, len(plans))
	for _, plan := range plans {
		result = append(result, string(plan))
	}
	return result
}

// Refusal builds the 403 problem for an operation that requires at least
// minimum.
func Refusal(minimum subscriptionspec.Plan) hubproblem.PlanRequiredDetails {
	return hubproblem.PlanRequiredError(minimum)
}
