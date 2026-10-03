// Package billing is the pure, database-free domain package for Hub
// subscriptions: period arithmetic, period-end advancement, plan-change
// decisions, and audit event construction. It owns no HTTP or SQL behavior.
package billing

import (
	"time"

	"backend/internal/billingperiod"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

func intervalMonths(interval subscriptionspec.BillingInterval) int {
	if interval == subscriptionspec.Year {
		return 12
	}
	return 1
}

// Instant is billingperiod.Instant.
func Instant(t time.Time) time.Time {
	return billingperiod.Instant(t)
}

// Boundary adds n billing intervals to anchor; see billingperiod.Boundary.
func Boundary(
	anchor time.Time, interval subscriptionspec.BillingInterval, n int,
) time.Time {
	return billingperiod.Boundary(anchor, intervalMonths(interval), n)
}

func boundaryIndex(
	anchor time.Time, interval subscriptionspec.BillingInterval, at time.Time,
) int {
	return billingperiod.BoundaryIndex(anchor, intervalMonths(interval), at)
}

// PeriodContaining returns the period for the largest n >= 0 with
// Boundary(n) <= at.
func PeriodContaining(
	anchor time.Time, interval subscriptionspec.BillingInterval, at time.Time,
) (time.Time, time.Time) {
	return billingperiod.PeriodContaining(anchor, intervalMonths(interval), at)
}
