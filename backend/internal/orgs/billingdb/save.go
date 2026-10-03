package billingdb

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/orgs/billing"
	"backend/internal/orgs/entitlements"
)

// SaveQueries is the one write a subscription change makes.
type SaveQueries interface {
	SaveOrgSubscription(
		context.Context, sqlc.SaveOrgSubscriptionParams,
	) (sqlc.SaveOrgSubscriptionRow, error)
}

// Change is everything one save writes. System are the transitions that were
// due ahead of the request (or all of a worker's), Decided is the request's
// own effect, and Advanced is the state Decided applied to.
type Change struct {
	OrgDID   pgtype.UUID
	Before   billing.State
	Advanced billing.State
	Final    billing.State
	System   []billing.Transition
	Decided  *billing.Transition

	// Actor is credited with Decided; System transitions are credited to the
	// system or worker actor named by SystemActor.
	Actor       billing.Actor
	SystemActor billing.Actor

	// PaidBy is the Org user who paid an invoice, if one did.
	PaidBy pgtype.UUID

	// Key is the request's idempotency key, empty for a worker.
	Key      common.IdempotencyKey
	TenantID string
	Source   string
}

// Save writes the final state, the net invoice writes, and one audit event
// per transition, in the caller's transaction. It fails if the statement did
// not write exactly what was decided.
func Save(ctx context.Context, q SaveQueries, change Change) error {
	all := append([]billing.Transition{}, change.System...)
	events := billing.TransitionEvents(change.Before, change.System, change.SystemActor)
	if change.Decided != nil {
		all = append(all, *change.Decided)
		if event := billing.DecisionEvent(
			change.Advanced, change.Decided, change.Actor,
		); event != nil {
			events = append(events, *event)
		}
	}
	changes := billing.FoldInvoiceChanges(all)
	for _, invoice := range changes {
		if !invoice.Valid() {
			return fmt.Errorf("incomplete %s invoice change", invoice.Op)
		}
	}
	changesJSON, err := billing.InvoiceChangesJSON(changes)
	if err != nil {
		return err
	}
	eventsJSON, err := billing.EventsJSON(events)
	if err != nil {
		return err
	}
	final := change.Final
	params := sqlc.SaveOrgSubscriptionParams{
		LogoPlanOids: entitlements.PlanOIDs(subscriptionspec.AllowsLogo),
		GoogleSignInPlanOids: entitlements.PlanOIDs(
			subscriptionspec.AllowsGoogleSignIn,
		),
		OrgPlanOid:     string(final.Plan),
		BillingState:   sqlc.VetchiumOrgBillingStateCurrent,
		OrgDid:         change.OrgDID,
		InvoiceChanges: changesJSON,
		PaidBy:         change.PaidBy,
		TenantID:       change.TenantID,
		Source:         change.Source,
		Events:         eventsJSON,
	}
	if change.Key != "" {
		params.IdempotencyKey = dbvalue.Text(string(change.Key))
	}
	if final.PastDue() {
		params.BillingState = sqlc.VetchiumOrgBillingStatePastDue
	}
	if final.Plan != subscriptionspec.FreeTier {
		params.OrgBillingInterval = sqlc.NullVetchiumOrgBillingInterval{
			VetchiumOrgBillingInterval: sqlc.VetchiumOrgBillingInterval(final.Interval),
			Valid:                      true,
		}
		params.SubscriptionAnchorAt = dbvalue.Timestamp(final.AnchorAt)
		params.SubscriptionPeriodStart = dbvalue.Timestamp(final.PeriodStart)
		params.SubscriptionPeriodEnd = dbvalue.Timestamp(final.PeriodEnd)
	}
	if final.HasSchedule() {
		params.ScheduledOrgPlanOid = dbvalue.Text(string(final.ScheduledPlan))
		if final.ScheduledPlan != subscriptionspec.FreeTier {
			params.ScheduledBillingInterval = sqlc.NullVetchiumOrgBillingInterval{
				VetchiumOrgBillingInterval: sqlc.VetchiumOrgBillingInterval(
					final.ScheduledInterval,
				),
				Valid: true,
			}
		}
	}
	saved, err := q.SaveOrgSubscription(ctx, params)
	if err != nil {
		return err
	}
	written := saved.CreatedCount + saved.PaidCount + saved.FailedCount +
		saved.VoidedCount
	if saved.UpdatedCount != 1 || saved.AuditedCount != int64(len(events)) ||
		written != int64(len(changes)) {
		return fmt.Errorf(
			"save Org subscription: updated=%d audited=%d written=%d, "+
				"want updated=1 audited=%d written=%d",
			saved.UpdatedCount, saved.AuditedCount, written,
			len(events), len(changes),
		)
	}
	return nil
}
