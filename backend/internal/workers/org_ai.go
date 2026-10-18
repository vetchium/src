package workers

import (
	"context"
	"fmt"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/appconfig"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// orgAIBatches bounds one run; each batch is at most a hundred rows.
const orgAIBatches = 10

type orgAIQueries interface {
	GrantOrgAICredits(
		context.Context, sqlc.GrantOrgAICreditsParams,
	) (sqlc.GrantOrgAICreditsRow, error)
	AbandonOrgAIReservations(
		context.Context, sqlc.AbandonOrgAIReservationsParams,
	) (sqlc.AbandonOrgAIReservationsRow, error)
	DeleteExpiredOrgAIUsageTexts(context.Context, string) (int32, error)
}

type orgAIJobs struct {
	queries            orgAIQueries
	reservationTimeout time.Duration
	now                func() time.Time
}

// EnableOrgAI runs the AI credit and retention jobs of a tenant that offers
// AI.
func (w *Worker) EnableOrgAI(config appconfig.AI) {
	w.orgAI = &orgAIJobs{
		queries:            w.queries,
		reservationTimeout: config.ReservationTimeout,
		now:                time.Now,
	}
	w.jobs = append(w.jobs,
		periodicJob{
			name: "grant-org-ai-credits", interval: config.GrantCreditsInterval,
			run: w.grantOrgAICredits,
		},
		periodicJob{
			name:     "abandon-org-ai-reservations",
			interval: config.ReleaseReservationsInterval,
			run:      w.abandonOrgAIReservations,
		},
		periodicJob{
			name: "delete-org-ai-usage-texts", interval: w.pictureDeletionInterval,
			run: w.deleteOrgAIUsageTexts,
		},
	)
}

// grantOrgAICredits gives every Org on a plan with monthly credits its grant
// for the current UTC month. The plans and amounts come from the contract.
func (w *Worker) grantOrgAICredits(ctx context.Context) error {
	params := sqlc.GrantOrgAICreditsParams{TenantID: w.tenantID}
	for _, plan := range subscriptionspec.Plans() {
		if credits := subscriptionspec.AICreditsPerMonth(plan); credits > 0 {
			params.PlanOids = append(params.PlanOids, string(plan))
			params.Credits = append(params.Credits, credits)
		}
	}
	if len(params.PlanOids) == 0 {
		return nil
	}
	for range orgAIBatches {
		row, err := w.orgAI.queries.GrantOrgAICredits(ctx, params)
		if err != nil {
			return fmt.Errorf("grant Org AI credits: %w", err)
		}
		if row.GrantedCount != row.AuditCount {
			return fmt.Errorf("unaudited Org AI credit grants")
		}
		if row.GrantedCount > 0 {
			w.log.Info("Org AI credits granted", "event", "org_ai_credits_granted",
				"count", row.GrantedCount)
		}
		if row.GrantedCount < 100 {
			return nil
		}
	}
	return nil
}

// abandonOrgAIReservations releases reservations whose request never
// settled, such as after a crash, charging nothing.
func (w *Worker) abandonOrgAIReservations(ctx context.Context) error {
	cutoff := w.orgAI.now().Add(-w.orgAI.reservationTimeout)
	for range orgAIBatches {
		row, err := w.orgAI.queries.AbandonOrgAIReservations(ctx,
			sqlc.AbandonOrgAIReservationsParams{
				ReservedBefore: dbvalue.Timestamp(cutoff), TenantID: w.tenantID,
			})
		if err != nil {
			return fmt.Errorf("abandon Org AI reservations: %w", err)
		}
		if row.AbandonedCount != row.AuditCount {
			return fmt.Errorf("unaudited Org AI reservation release")
		}
		if row.AbandonedCount > 0 {
			w.log.Warn("Org AI reservations abandoned",
				"event", "org_ai_reservations_abandoned",
				"count", row.AbandonedCount)
		}
		if row.AbandonedCount < 100 {
			return nil
		}
	}
	return nil
}

func (w *Worker) deleteOrgAIUsageTexts(ctx context.Context) error {
	for range orgAIBatches {
		deleted, err := w.orgAI.queries.DeleteExpiredOrgAIUsageTexts(
			ctx, w.tenantID,
		)
		if err != nil {
			return fmt.Errorf("delete expired Org AI usage texts: %w", err)
		}
		if deleted < 1000 {
			return nil
		}
	}
	return nil
}
