// Package users is the Org user-management policy: how many seats an Org may
// use and who may grant what. It owns no HTTP or SQL.
package users

import (
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

// SeatLimit is the cap on active users plus unexpired invitations. While a
// downgrade is scheduled the cap is the lower of the current and scheduled
// plans', so the transition can never find excess users (D13). An unknown
// plan has a cap of zero: it grants nothing it cannot name.
func SeatLimit(
	current subscriptionspec.PlanOID, scheduled *subscriptionspec.Plan,
	googleSignInEnabled bool,
) (limit int, unlimited bool) {
	limit, unlimited = subscriptionspec.MaxUsers(
		subscriptionspec.Plan(current), googleSignInEnabled,
	)
	if scheduled == nil {
		return limit, unlimited
	}
	scheduledLimit, scheduledUnlimited := subscriptionspec.MaxUsers(
		*scheduled, googleSignInEnabled,
	)
	switch {
	case scheduledUnlimited:
		return limit, unlimited
	case unlimited, scheduledLimit < limit:
		return scheduledLimit, false
	default:
		return limit, false
	}
}
