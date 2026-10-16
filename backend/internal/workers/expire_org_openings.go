package workers

import (
	"context"
	"fmt"

	"backend/internal/db/sqlc"
)

const openingExpiryBatchSize = 100
const maxOpeningExpiryBatches = 10

type openingExpiryQueries interface {
	ExpireOrgOpenings(context.Context, string) (sqlc.ExpireOrgOpeningsRow, error)
}

func (w *Worker) expireOrgOpenings(ctx context.Context) error {
	for range maxOpeningExpiryBatches {
		row, err := w.openingExpiryQueries.ExpireOrgOpenings(ctx, w.tenantID)
		if err != nil {
			return fmt.Errorf("expire Org Openings: %w", err)
		}
		if row.ExpiredCount > 0 {
			w.log.Info("Org Openings expired", "count", row.ExpiredCount)
		}
		if row.ExpiredCount < openingExpiryBatchSize {
			break
		}
	}
	return nil
}
