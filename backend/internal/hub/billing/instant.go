// Package billing is the pure, database-free domain package for Hub
// subscriptions: period arithmetic, period-end advancement, plan-change
// decisions, and audit event construction. It owns no HTTP or SQL behavior.
package billing

import "time"

// Instant truncates to the precision timestamptz stores, and converts to
// UTC. Every instant that reaches a response, and every instant read back
// from the database, passes through this so that a response built from a
// decided state equals the later GET exactly.
func Instant(t time.Time) time.Time {
	return t.UTC().Truncate(time.Microsecond)
}
