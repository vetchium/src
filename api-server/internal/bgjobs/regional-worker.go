package bgjobs

import (
	"context"
	"log/slog"
	"time"

	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// RegionalWorker runs background jobs for a regional database.
// This includes cleanup of expired tokens and sessions.
//
// IMPORTANT: There should be exactly ONE RegionalWorker instance per region,
// following the same pattern as the email worker.
type RegionalWorker struct {
	queries    *regionaldb.Queries
	config     *RegionalBgJobsConfig
	log        *slog.Logger
	regionName string
}

// NewRegionalWorker creates a new regional background jobs worker
func NewRegionalWorker(
	queries *regionaldb.Queries,
	config *RegionalBgJobsConfig,
	log *slog.Logger,
	regionName string,
) *RegionalWorker {
	return &RegionalWorker{
		queries:    queries,
		config:     config,
		log:        log.With("component", "regional-bgjobs-worker", "region", regionName),
		regionName: regionName,
	}
}

// Run starts the regional background jobs worker. It blocks until ctx is cancelled.
func (w *RegionalWorker) Run(ctx context.Context) {
	w.log.Info("starting regional background jobs worker",
		"hub_tfa_cleanup_interval", w.config.ExpiredHubTFATokensCleanupInterval,
		"hub_sessions_cleanup_interval", w.config.ExpiredHubSessionsCleanupInterval,
	)

	// Create independent tickers for each cleanup job
	hubTFATicker := time.NewTicker(w.config.ExpiredHubTFATokensCleanupInterval)
	hubSessionsTicker := time.NewTicker(w.config.ExpiredHubSessionsCleanupInterval)

	defer hubTFATicker.Stop()
	defer hubSessionsTicker.Stop()

	// Run cleanup immediately on start
	w.cleanupExpiredHubTFATokens(ctx)
	w.cleanupExpiredHubSessions(ctx)

	for {
		select {
		case <-ctx.Done():
			w.log.Info("regional background jobs worker stopping")
			return
		case <-hubTFATicker.C:
			w.cleanupExpiredHubTFATokens(ctx)
		case <-hubSessionsTicker.C:
			w.cleanupExpiredHubSessions(ctx)
		}
	}
}

func (w *RegionalWorker) cleanupExpiredHubTFATokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredHubTFATokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired hub TFA tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired hub TFA tokens")
}

func (w *RegionalWorker) cleanupExpiredHubSessions(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredHubSessions(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired hub sessions", "error", err)
		return
	}
	w.log.Debug("cleaned up expired hub sessions")
}
