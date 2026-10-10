// Package entitlements turns an Org plan's contract constants into the
// decisions features make. Openings are not built yet; this fixes the rule
// they must follow so the first implementation cannot invent another.
package entitlements

import (
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

// QuotaWindow is how far back created Openings count.
const QuotaWindow = 365 * 24 * time.Hour

// OpeningQuota is how many Openings an Org on plan may create per rolling
// QuotaWindow, drafts included. An unknown plan has none, so a plan the code
// cannot name grants nothing.
//
// The counting rule for the statement that creates an Opening (new or
// duplicated):
//
//   - Count the Org's Openings whose creation time is after WindowStart(now),
//     whatever their state today: discarding a draft or closing an Opening
//     does not give its slot back.
//   - Creating one more is allowed only if that count is below the quota.
//   - Lock the Org row (FOR UPDATE) first and check the count in the same
//     statement that inserts, so two concurrent creations cannot both take
//     the last slot, and a concurrent downgrade cannot be overtaken.
//   - Refuse with a quota problem naming the quota and the count; never
//     refuse on a stale read.
func OpeningQuota(plan subscriptionspec.PlanOID) int {
	if !subscriptionspec.IsPlan(plan) {
		return 0
	}
	return subscriptionspec.OpeningsPerYear(subscriptionspec.Plan(plan))
}

// WindowStart is the earliest publication time that still counts at now.
func WindowStart(now time.Time) time.Time {
	return now.UTC().Add(-QuotaWindow)
}

// CanCreate reports whether an Org with created Openings inside the window
// may create another under plan.
func CanCreate(plan subscriptionspec.PlanOID, created int) bool {
	return created < OpeningQuota(plan)
}
