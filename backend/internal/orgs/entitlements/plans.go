package entitlements

import (
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

// PlanOIDs returns the plans for which allows holds, ready for a gated
// statement's `org_plan_oid = ANY(...)` predicate, so the decision stays in
// the writing statement and its plans come from the contract.
func PlanOIDs(allows func(subscriptionspec.Plan) bool) []string {
	oids := make([]string, 0, len(subscriptionspec.Plans()))
	for _, plan := range subscriptionspec.Plans() {
		if allows(plan) {
			oids = append(oids, string(plan))
		}
	}
	return oids
}
