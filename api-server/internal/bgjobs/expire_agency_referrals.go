package bgjobs

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// expireAgencyReferrals sweeps pending agency referrals whose invitation window
// has elapsed (the candidate neither applied nor declined) into the 'expired'
// state, writing one audit log entry per referral with actor_user_id = NULL
// inside the same transaction. The global referral index is then updated
// best-effort so the candidate's inbox and the agency workspace both reflect the
// expiry.
func (w *RegionalWorker) expireAgencyReferrals(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	w.log.Debug("running expire-agency-referrals job")

	var expired []regionaldb.AgencyReferral
	err := pgx.BeginFunc(ctx, w.pool, func(tx pgx.Tx) error {
		qtx := regionaldb.New(tx)

		rows, err := qtx.WorkerExpireAgencyReferrals(ctx)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}

		for _, ref := range rows {
			eventData, _ := json.Marshal(map[string]any{
				"referral_id": ref.ReferralID.String(),
				"opening_id":  ref.OpeningID.String(),
			})
			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.expire_referral",
				ActorUserID: pgtype.UUID{Valid: false}, // NULL — system-initiated
				OrgID:       ref.OrgID,
				IpAddress:   "worker",
				EventData:   eventData,
			}); err != nil {
				return err
			}
		}

		expired = rows
		return nil
	})
	if err != nil {
		w.log.Error("failed to expire agency referrals", "error", err)
		return
	}

	if len(expired) == 0 {
		return
	}

	// Cross-DB: mirror the expiry into the global referral index (best-effort).
	for _, ref := range expired {
		if idxErr := w.globalDB.UpdateAgencyReferralIndexState(ctx, globaldb.UpdateAgencyReferralIndexStateParams{
			ReferralID: ref.ReferralID,
			State:      "expired",
		}); idxErr != nil {
			w.log.Error("CONSISTENCY_ALERT: failed to update referral index state after expiry",
				"referral_id", ref.ReferralID.String(), "error", idxErr)
		}
	}

	w.log.Info("expired_agency_referrals_swept", "count", len(expired))
}
