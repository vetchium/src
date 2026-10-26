package workers

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	federationspec "github.com/vetchium/src/typespec/federation"

	"backend/internal/db/sqlc"
	"backend/internal/hubapplications"
)

const maxHubRefreshBatches = 10

// refreshHubApplications re-reports to their applicants the applications
// whose projection is stale only because time passed: an unanswered
// interview that started (HP-HUB-007), and an offer about to expire, which
// also asks for the expiring email (HP-GEN-006).
func (w *Worker) refreshHubApplications(ctx context.Context) error {
	for range maxHubRefreshBatches {
		n, err := refreshBatch(ctx, w.applicationDB, w.tenantID, "")
		if err != nil {
			return fmt.Errorf("refresh Hub applications: %w", err)
		}
		if n == 0 {
			break
		}
	}
	for range maxHubRefreshBatches {
		n, err := refreshBatch(ctx, w.applicationDB, w.tenantID,
			federationspec.NoticeOfferExpiring)
		if err != nil {
			return fmt.Errorf("notify expiring offers: %w", err)
		}
		if n == 0 {
			break
		}
	}
	return nil
}

// refreshBatch locks a batch, bumps its versions, and enqueues the events in
// one transaction. A notice selects the expiring-offer batch; none selects
// the stale-projection batch.
func refreshBatch(
	ctx context.Context, db *pgxpool.Pool, tenantID string,
	notice federationspec.ApplicationNotice,
) (int, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	var ids []pgtype.UUID
	if notice == "" {
		ids, err = q.LockOrgApplicationsDueForHubRefresh(ctx)
	} else {
		ids, err = q.LockOrgApplicationsWithExpiringOffers(ctx)
	}
	if err != nil || len(ids) == 0 {
		return 0, err
	}
	var changed []pgtype.UUID
	if notice == "" {
		rows, err := q.BumpOrgApplicationsForHubRefresh(ctx,
			sqlc.BumpOrgApplicationsForHubRefreshParams{
				ApplicationIds: ids, TenantID: tenantID,
			})
		if err != nil {
			return 0, err
		}
		for _, row := range rows {
			if row.BumpedRows != row.AuditRows {
				return 0, fmt.Errorf("incomplete projection refresh")
			}
			changed = append(changed, row.OrgApplicationID)
		}
	} else {
		rows, err := q.MarkOrgApplicationOffersExpiring(ctx,
			sqlc.MarkOrgApplicationOffersExpiringParams{
				ApplicationIds: ids, TenantID: tenantID,
			})
		if err != nil {
			return 0, err
		}
		for _, row := range rows {
			if row.MarkedRows != row.BumpedRows ||
				row.BumpedRows != row.AuditRows {
				return 0, fmt.Errorf("incomplete offer expiring notice")
			}
			changed = append(changed, row.OrgApplicationID)
		}
	}
	if len(changed) > 0 {
		if err := hubapplications.EnqueueNotifiedChanges(
			ctx, q, changed, notice,
		); err != nil {
			return 0, err
		}
	}
	return len(changed), tx.Commit(ctx)
}
