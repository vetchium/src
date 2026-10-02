package subscriptions

import (
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/orgs/billing"
	orgusers "backend/internal/orgs/users"
)

func timePtr(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	utc := t.UTC()
	return &utc
}

func invoiceResponse(invoice billing.Invoice) subscriptionspec.OrgInvoice {
	response := subscriptionspec.OrgInvoice{
		InvoiceID:       invoice.ID,
		PlanOID:         subscriptionspec.PlanOID(invoice.Plan),
		BillingInterval: invoice.Interval,
		PeriodStart:     invoice.PeriodStart.UTC(),
		PeriodEnd:       invoice.PeriodEnd.UTC(),
		Reason:          invoice.Reason,
		State:           invoice.State,
		CreatedAt:       invoice.CreatedAt.UTC(),
		DueAt:           timePtr(invoice.DueAt),
		PaidAt:          timePtr(invoice.PaidAt),
		AttemptCount:    int32(invoice.AttemptCount),
	}
	if invoice.LastFailure != "" {
		failure := invoice.LastFailure
		response.LastFailure = &failure
	}
	return response
}

// responseFromState is the wire view of a subscription. The seat cap is the
// lower of the current and any scheduled plan's, as for invitations.
func responseFromState(state billing.State, seatsInUse int64) subscriptionspec.OrgSubscription {
	response := subscriptionspec.OrgSubscription{
		PlanOID:           subscriptionspec.PlanOID(state.Plan),
		CancelAtPeriodEnd: state.ScheduledPlan == subscriptionspec.FreeTier,
		BillingState:      state.Billing,
		SeatsInUse:        int32(seatsInUse),
	}
	if state.Plan != subscriptionspec.FreeTier {
		interval := state.Interval
		start, end := state.PeriodStart.UTC(), state.PeriodEnd.UTC()
		response.BillingInterval = &interval
		response.CurrentPeriodStart = &start
		response.CurrentPeriodEnd = &end
	}
	if state.HasSchedule() {
		change := subscriptionspec.ScheduledPlanChange{
			PlanOID: subscriptionspec.PlanOID(state.ScheduledPlan),
		}
		if state.ScheduledPlan != subscriptionspec.FreeTier {
			interval := state.ScheduledInterval
			change.BillingInterval = &interval
		}
		response.ScheduledChange = &change
	}
	if state.Open != nil {
		invoice := invoiceResponse(*state.Open)
		response.OpenInvoice = &invoice
	}
	if state.PaymentMethod != "" {
		response.PaymentMethod = &subscriptionspec.OrgPaymentMethod{
			Kind: state.PaymentMethod,
		}
	}
	var scheduled *subscriptionspec.Plan
	if state.HasSchedule() {
		plan := state.ScheduledPlan
		scheduled = &plan
	}
	if limit, unlimited := orgusers.SeatLimit(
		subscriptionspec.PlanOID(state.Plan), scheduled, false,
	); !unlimited {
		value := int32(limit)
		response.SeatLimit = &value
	}
	return response
}
