// Package users owns Org seat and delegation policy.
package users

import subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

// SeatLimit counts active users and unexpired invitations. Unknown plans grant no seats.
func SeatLimit(current subscriptionspec.PlanOID, googleSignInEnabled bool) (int, bool) {
	return subscriptionspec.MaxUsers(subscriptionspec.Plan(current), googleSignInEnabled)
}
