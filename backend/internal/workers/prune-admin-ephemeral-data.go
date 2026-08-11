package workers

import (
	"context"
	"fmt"
)

type adminEphemeralDelete struct {
	name string
	run  func(context.Context) (int64, error)
}

func (w *Worker) pruneAdminEphemeralData(ctx context.Context) error {
	deletes := []adminEphemeralDelete{
		{"login challenges", w.queries.PruneAdminLoginChallenges},
		{"TOTP enrollments", w.queries.PruneAdminTOTPEnrollments},
		{"password resets", w.queries.PruneAdminPasswordResets},
		{"invitations", w.queries.PruneAdminInvitations},
		{"consumed TOTP recovery codes", w.queries.PruneConsumedAdminTOTPRecoveryCodes},
		{"email outbox rows", w.queries.PruneAdminEmailOutbox},
	}
	for _, deletion := range deletes {
		count, err := deletion.run(ctx)
		if err != nil {
			return fmt.Errorf("prune admin %s: %w", deletion.name, err)
		}
		if count > 0 {
			w.log.Info("admin ephemeral data deleted", "kind", deletion.name, "count", count)
		}
	}
	return nil
}
