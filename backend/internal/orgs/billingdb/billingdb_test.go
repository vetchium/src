package billingdb

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/orgs/billing"
)

func TestStoredFromRowRoundTripsThroughTheBillingRules(t *testing.T) {
	t.Parallel()
	anchor := time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC)
	orgDID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	invoiceID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	row := sqlc.GetOrgSubscriptionRow{
		OrgPlanOid: "org-silver-tier",
		OrgBillingInterval: sqlc.NullVetchiumOrgBillingInterval{
			VetchiumOrgBillingInterval: sqlc.VetchiumOrgBillingIntervalMonth, Valid: true,
		},
		SubscriptionAnchorAt:    dbvalue.Timestamp(anchor),
		SubscriptionPeriodStart: dbvalue.Timestamp(anchor),
		SubscriptionPeriodEnd:   dbvalue.Timestamp(anchor.AddDate(0, 1, 0)),
		ScheduledOrgPlanOid:     pgtype.Text{String: "org-free-tier", Valid: true},
		BillingState:            sqlc.VetchiumOrgBillingStatePastDue,
		PaymentMethodKind: sqlc.NullVetchiumOrgPaymentMethodKind{
			VetchiumOrgPaymentMethodKind: sqlc.VetchiumOrgPaymentMethodKindSimulatedDeclines, Valid: true,
		},
		OpenInvoiceID:      invoiceID,
		OpenInvoicePlanOid: pgtype.Text{String: "org-silver-tier", Valid: true},
		OpenInvoiceBillingInterval: sqlc.NullVetchiumOrgBillingInterval{
			VetchiumOrgBillingInterval: sqlc.VetchiumOrgBillingIntervalMonth, Valid: true,
		},
		OpenInvoicePeriodStart: dbvalue.Timestamp(anchor),
		OpenInvoicePeriodEnd:   dbvalue.Timestamp(anchor.AddDate(0, 1, 0)),
		OpenInvoiceReason: sqlc.NullVetchiumOrgInvoiceReason{
			VetchiumOrgInvoiceReason: sqlc.VetchiumOrgInvoiceReasonRenewal, Valid: true,
		},
		OpenInvoiceDueAt:         dbvalue.Timestamp(anchor.AddDate(0, 0, 14)),
		OpenInvoiceAttemptCount:  pgtype.Int4{Int32: 2, Valid: true},
		OpenInvoiceNextAttemptAt: dbvalue.Timestamp(anchor.AddDate(0, 0, 7)),
		OpenInvoiceLastFailure: sqlc.NullVetchiumOrgInvoiceFailure{
			VetchiumOrgInvoiceFailure: sqlc.VetchiumOrgInvoiceFailureDeclined, Valid: true,
		},
		OpenInvoiceCreatedAt: dbvalue.Timestamp(anchor),
	}
	state, err := billing.StateFromStored(StoredFromRow(orgDID, row))
	if err != nil {
		t.Fatal(err)
	}
	if !state.PastDue() || state.Open == nil || state.Open.AttemptCount != 2 ||
		state.Open.ID != dbvalue.FormatUUID(invoiceID) ||
		state.Open.LastFailure != subscriptionspec.FailureDeclined ||
		state.PaymentMethod != subscriptionspec.SimulatedDeclines ||
		state.ScheduledPlan != subscriptionspec.FreeTier {
		t.Fatalf("state = %+v", state)
	}

	free := sqlc.GetOrgSubscriptionRow{
		OrgPlanOid: "org-free-tier", BillingState: sqlc.VetchiumOrgBillingStateCurrent,
	}
	freeState, err := billing.StateFromStored(StoredFromRow(orgDID, free))
	if err != nil || freeState.Plan != subscriptionspec.FreeTier ||
		freeState.PaymentMethod != "" || freeState.Open != nil {
		t.Fatalf("free state = %+v, %v", freeState, err)
	}
}
