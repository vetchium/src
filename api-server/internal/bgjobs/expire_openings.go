package bgjobs

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// expireOpenings runs the opening expiry job. It queries for openings that have passed
// the 180-day expiry threshold and transitions them to expired, writing one audit log
// entry per opening with actor_user_id = NULL inside the same transaction.
func (w *RegionalWorker) expireOpenings(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	w.log.Debug("running expire-openings job")

	// Execute within a regional transaction
	err := pgx.BeginFunc(ctx, w.pool, func(tx pgx.Tx) error {
		qtx := regionaldb.New(tx)

		// Fetch all openings that should be expired
		expiredOpenings, err := qtx.WorkerExpireOpenings(ctx)
		if err != nil {
			return err
		}

		if len(expiredOpenings) == 0 {
			return nil
		}

		// Write audit log for each expired opening
		for _, opening := range expiredOpenings {
			eventData, _ := json.Marshal(map[string]any{
				"opening_id":     opening.OpeningID.String(),
				"opening_number": opening.OpeningNumber,
				"expired_at":     opening.ExpiredAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00"),
			})

			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.expire_opening",
				ActorUserID: pgtype.UUID{Valid: false}, // NULL
				OrgID:       opening.OrgID,
				IpAddress:   "worker",
				EventData:   eventData,
			}); err != nil {
				return err
			}
		}

		w.log.Info("expired_openings_swept", "count", len(expiredOpenings))
		return nil
	})

	if err != nil {
		w.log.Error("failed to expire openings", "error", err)
	}
}
