// Package billingdb reads the stored subscription of an Org into the
// database-free input of the billing rules.
package billingdb

import (
	"github.com/jackc/pgx/v5/pgtype"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/orgs/billing"
)

func intervalString(value sqlc.NullVetchiumOrgBillingInterval) string {
	if !value.Valid {
		return ""
	}
	return string(value.VetchiumOrgBillingInterval)
}

// storedFromRow turns the subscription columns and the open invoice into the
// database-free input of the billing rules.
func StoredFromRow(
	orgDID pgtype.UUID, row sqlc.GetOrgSubscriptionRow,
) billing.Stored {
	stored := billing.Stored{
		OrgDID:            dbvalue.FormatUUID(orgDID),
		PlanOID:           row.OrgPlanOid,
		Interval:          intervalString(row.OrgBillingInterval),
		AnchorAt:          dbvalue.TimePtr(row.SubscriptionAnchorAt),
		PeriodStart:       dbvalue.TimePtr(row.SubscriptionPeriodStart),
		PeriodEnd:         dbvalue.TimePtr(row.SubscriptionPeriodEnd),
		ScheduledPlanOID:  row.ScheduledOrgPlanOid.String,
		ScheduledInterval: intervalString(row.ScheduledBillingInterval),
		PastDue:           row.BillingState == sqlc.VetchiumOrgBillingStatePastDue,
	}
	if row.PaymentMethodKind.Valid {
		stored.PaymentMethod = string(
			row.PaymentMethodKind.VetchiumOrgPaymentMethodKind,
		)
	}
	if row.OpenInvoiceID.Valid {
		invoice := billing.Invoice{
			ID:          dbvalue.FormatUUID(row.OpenInvoiceID),
			Plan:        subscriptionspec.Plan(row.OpenInvoicePlanOid.String),
			Interval:    subscriptionspec.BillingInterval(intervalString(row.OpenInvoiceBillingInterval)),
			PeriodStart: row.OpenInvoicePeriodStart.Time,
			PeriodEnd:   row.OpenInvoicePeriodEnd.Time,
			Reason: subscriptionspec.InvoiceReason(
				row.OpenInvoiceReason.VetchiumOrgInvoiceReason,
			),
			State:        subscriptionspec.InvoiceOpen,
			DueAt:        row.OpenInvoiceDueAt.Time,
			AttemptCount: int(row.OpenInvoiceAttemptCount.Int32),
			LastFailure: subscriptionspec.InvoiceFailure(
				row.OpenInvoiceLastFailure.VetchiumOrgInvoiceFailure,
			),
			CreatedAt: row.OpenInvoiceCreatedAt.Time,
		}
		if row.OpenInvoiceNextAttemptAt.Valid {
			invoice.NextAttemptAt = row.OpenInvoiceNextAttemptAt.Time
		}
		stored.OpenInvoice = &invoice
	}
	return stored
}
