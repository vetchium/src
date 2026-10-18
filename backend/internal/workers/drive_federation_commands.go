package workers

import (
	"context"
	"fmt"
)

func (w *Worker) driveFederationCommands(ctx context.Context) error {
	resolved, err := w.federationCommands.Recover(ctx)
	if resolved > 0 {
		w.log.Info(
			"federation command operations resolved",
			"event", "federation_commands_recovered", "count", resolved,
		)
	}
	if err != nil {
		return fmt.Errorf("drive federation commands: %w", err)
	}
	return nil
}
