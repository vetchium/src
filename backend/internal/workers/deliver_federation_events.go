package workers

import (
	"context"
	"fmt"
)

func (w *Worker) deliverFederationEvents(ctx context.Context) error {
	delivered, err := w.federationEvents.Deliver(ctx)
	if delivered > 0 {
		w.log.Info(
			"federation events delivered",
			"event", "federation_events_delivered", "count", delivered,
		)
	}
	if err != nil {
		return fmt.Errorf("deliver federation events: %w", err)
	}
	return nil
}
