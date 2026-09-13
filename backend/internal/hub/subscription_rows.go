package hub

import "backend/internal/db/sqlc"

// BillingIntervalFromNull returns "" for SQL NULL, matching billing.Stored's
// zero value for an unset interval.
func BillingIntervalFromNull(value sqlc.NullVetchiumHubBillingInterval) string {
	if !value.Valid {
		return ""
	}
	return string(value.VetchiumHubBillingInterval)
}
