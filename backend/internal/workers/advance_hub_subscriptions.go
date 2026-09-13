package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	"backend/internal/hub/billing"
)

// maxHubSubscriptionBatches bounds one run's work so a backlog above 1,000
// due rows completes over later runs instead of one run growing unbounded.
const maxHubSubscriptionBatches = 10
const hubSubscriptionBatchSize = 100

type subscriptionQueries interface {
	ClaimDueHubSubscriptions(
		context.Context, sqlc.ClaimDueHubSubscriptionsParams,
	) ([]sqlc.ClaimDueHubSubscriptionsRow, error)
	SaveHubSubscriptionStates(
		context.Context, sqlc.SaveHubSubscriptionStatesParams,
	) (sqlc.SaveHubSubscriptionStatesRow, error)
}

// subscriptionTransactions runs one batch in its own transaction. New builds
// it from the pool without calling Begin, which is what keeps the existing
// New(nil, ...) tests valid: the implementation only touches the pool when
// invoked.
type subscriptionTransactions interface {
	InTransaction(
		ctx context.Context, work func(subscriptionQueries) error,
	) error
}

type poolSubscriptionTransactions struct {
	db *pgxpool.Pool
}

func (p poolSubscriptionTransactions) InTransaction(
	ctx context.Context, work func(subscriptionQueries) error,
) error {
	tx, err := p.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin subscription advance transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := work(sqlc.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type skippedSubscription struct {
	did    pgtype.UUID
	planID string
	reason string
}

func (w *Worker) advanceHubSubscriptions(ctx context.Context) error {
	now := time.Now
	if w.hubSubscriptionNow != nil {
		now = w.hubSubscriptionNow
	}

	skipped := make([]pgtype.UUID, 0)
	var skippedDetails []skippedSubscription

	for range maxHubSubscriptionBatches {
		at := billing.Instant(now())
		var claimedCount int
		err := w.subscriptionTransactions.InTransaction(
			ctx, func(q subscriptionQueries) error {
				rows, err := q.ClaimDueHubSubscriptions(
					ctx, sqlc.ClaimDueHubSubscriptionsParams{
						At:                 dbvalue.Timestamp(at),
						SkippedHubUserDids: skipped,
						BatchSize:          hubSubscriptionBatchSize,
					},
				)
				if err != nil {
					return fmt.Errorf("claim due Hub subscriptions: %w", err)
				}
				claimedCount = len(rows)
				if claimedCount == 0 {
					return nil
				}

				var states []billing.StateRecord
				var events []billing.EventRecord
				for _, row := range rows {
					stored := storedFromClaim(row)
					state, err := billing.StateFromStored(stored)
					if err != nil {
						did := row.HubUserDid
						skipped = append(skipped, did)
						skippedDetails = append(skippedDetails, skippedSubscription{
							did: did, planID: row.HubPlanOid, reason: err.Error(),
						})
						continue
					}
					// The claim predicate only selects rows whose period has
					// already ended, so Advance always returns at least one
					// transition for a state that parsed successfully.
					advanced, transitions := billing.Advance(state, at)
					hubUserDID := dbvalue.FormatUUID(row.HubUserDid)
					states = append(
						states, billing.NewStateRecord(hubUserDID, advanced),
					)
					events = append(events, billing.SystemTransitionEvents(
						hubUserDID, state, transitions, billing.WorkerRenewalActor,
					)...)
				}
				if len(states) == 0 {
					return nil
				}

				statesJSON, err := json.Marshal(states)
				if err != nil {
					return err
				}
				eventsJSON, err := json.Marshal(events)
				if err != nil {
					return err
				}
				saved, err := q.SaveHubSubscriptionStates(
					ctx, sqlc.SaveHubSubscriptionStatesParams{
						States:   statesJSON,
						Events:   eventsJSON,
						TenantID: w.tenantID,
						Source:   billing.SourceWorkers,
					},
				)
				if err != nil {
					return fmt.Errorf("save Hub subscription states: %w", err)
				}
				if int(saved.UpdatedCount) != len(states) ||
					saved.AuditedCount != int64(len(events)) ||
					saved.AuditedUserCount != saved.UpdatedCount {
					return fmt.Errorf(
						"save Hub subscription states: updated=%d audited=%d "+
							"audited_users=%d, want updated=%d audited=%d",
						saved.UpdatedCount, saved.AuditedCount,
						saved.AuditedUserCount, len(states), len(events),
					)
				}
				return nil
			},
		)
		if err != nil {
			return err
		}
		if claimedCount < hubSubscriptionBatchSize {
			break
		}
	}

	if len(skippedDetails) > 0 {
		dids := make([]string, len(skippedDetails))
		planIDs := make([]string, len(skippedDetails))
		reasons := make([]string, len(skippedDetails))
		for i, skip := range skippedDetails {
			dids[i] = dbvalue.FormatUUID(skip.did)
			planIDs[i] = skip.planID
			reasons[i] = skip.reason
		}
		w.log.Error(
			"Hub subscriptions with an invalid stored state were skipped",
			"event", "hub_subscription_skipped",
			"count", len(skippedDetails),
			"hubUserDIDs", dids,
			"planOIDs", planIDs,
			"reasons", reasons,
		)
	}
	return nil
}

func storedFromClaim(row sqlc.ClaimDueHubSubscriptionsRow) billing.Stored {
	return billing.Stored{
		HubUserDID: dbvalue.FormatUUID(row.HubUserDid),
		PlanOID:    row.HubPlanOid,
		Interval: hubruntime.BillingIntervalFromNull(
			row.SubscriptionBillingInterval,
		),
		AnchorAt:         dbvalue.TimePtr(row.SubscriptionAnchorAt),
		PeriodStart:      dbvalue.TimePtr(row.SubscriptionPeriodStart),
		PeriodEnd:        dbvalue.TimePtr(row.SubscriptionPeriodEnd),
		ScheduledPlanOID: row.ScheduledHubPlanOid.String,
		ScheduledInterval: hubruntime.BillingIntervalFromNull(
			row.ScheduledBillingInterval,
		),
	}
}
