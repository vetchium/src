// Package billingperiod is the plan-agnostic calendar arithmetic shared by
// Hub and Org subscriptions. Callers map their own interval vocabulary to a
// month count and keep all plan policy.
package billingperiod

import "time"

// Instant truncates to the precision timestamptz stores, and converts to
// UTC. Every instant that reaches a response, and every instant read back
// from the database, passes through this so that a response built from a
// decided state equals the later GET exactly.
func Instant(t time.Time) time.Time {
	return t.UTC().Truncate(time.Microsecond)
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

// Boundary adds n intervals of intervalMonths months to anchor's year and
// month. The day is clamped to the target month's last day, the time of day
// is the anchor's, and the result is UTC. This is never time.AddDate, which
// turns Jan 31 plus one month into Mar 3.
func Boundary(anchor time.Time, intervalMonths, n int) time.Time {
	anchor = anchor.UTC()
	totalMonths := (int(anchor.Month()) - 1) + n*intervalMonths
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

// BoundaryIndex returns the largest n with Boundary(anchor, intervalMonths, n)
// <= at.
func BoundaryIndex(anchor time.Time, intervalMonths int, at time.Time) int {
	anchor = anchor.UTC()
	at = at.UTC()
	monthDiff := (at.Year()-anchor.Year())*12 +
		int(at.Month()) - int(anchor.Month())
	n := monthDiff / intervalMonths
	for Boundary(anchor, intervalMonths, n).After(at) {
		n--
	}
	for !Boundary(anchor, intervalMonths, n+1).After(at) {
		n++
	}
	return n
}

// PeriodContaining returns the period for the largest n >= 0 with
// Boundary(n) <= at.
func PeriodContaining(
	anchor time.Time, intervalMonths int, at time.Time,
) (time.Time, time.Time) {
	n := max(BoundaryIndex(anchor, intervalMonths, at), 0)
	return Boundary(anchor, intervalMonths, n),
		Boundary(anchor, intervalMonths, n+1)
}
