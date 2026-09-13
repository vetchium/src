package billing

import (
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

func intervalMonths(interval subscriptionspec.BillingInterval) int {
	if interval == subscriptionspec.Year {
		return 12
	}
	return 1
}

// floorDivMod is integer division and modulus rounded toward negative
// infinity, which time.Month arithmetic below needs for a negative n.
func floorDivMod(a, b int) (int, int) {
	q := a / b
	r := a % b
	if r != 0 && (r < 0) != (b < 0) {
		q--
		r += b
	}
	return q, r
}

func lastDayOfMonth(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// Boundary adds n intervals to anchor's year and month. The day is clamped to
// the target month's last day, the time of day is the anchor's, and the
// result is UTC. This is never time.AddDate, which turns Jan 31 plus one
// month into Mar 3.
func Boundary(
	anchor time.Time, interval subscriptionspec.BillingInterval, n int,
) time.Time {
	anchor = anchor.UTC()
	totalMonths := (int(anchor.Month()) - 1) + n*intervalMonths(interval)
	yearOffset, monthIndex := floorDivMod(totalMonths, 12)
	year := anchor.Year() + yearOffset
	month := time.Month(monthIndex + 1)
	day := min(anchor.Day(), lastDayOfMonth(year, month))
	return time.Date(
		year, month, day,
		anchor.Hour(), anchor.Minute(), anchor.Second(), anchor.Nanosecond(),
		time.UTC,
	)
}

// boundaryIndex returns the largest n with Boundary(anchor, interval, n) <= at.
func boundaryIndex(
	anchor time.Time, interval subscriptionspec.BillingInterval, at time.Time,
) int {
	anchor = anchor.UTC()
	at = at.UTC()
	monthDiff := (at.Year()-anchor.Year())*12 +
		int(at.Month()) - int(anchor.Month())
	n := monthDiff / intervalMonths(interval)
	for Boundary(anchor, interval, n).After(at) {
		n--
	}
	for !Boundary(anchor, interval, n+1).After(at) {
		n++
	}
	return n
}

// PeriodContaining returns the period for the largest n >= 0 with
// Boundary(n) <= at.
func PeriodContaining(
	anchor time.Time, interval subscriptionspec.BillingInterval, at time.Time,
) (time.Time, time.Time) {
	n := max(boundaryIndex(anchor, interval, at), 0)
	return Boundary(anchor, interval, n), Boundary(anchor, interval, n+1)
}
