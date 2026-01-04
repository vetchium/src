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

// Run starts the regional background jobs worker. It launches goroutines for each
// job and returns immediately. Each job runs in its own goroutine with an
// independent ticker to prevent starvation. Goroutines exit when ctx is cancelled.
func (w *RegionalWorker) Run(ctx context.Context) {
	w.log.Info("starting regional background jobs worker",
		"hub_tfa_cleanup_interval", w.config.ExpiredHubTFATokensCleanupInterval,
		"hub_sessions_cleanup_interval", w.config.ExpiredHubSessionsCleanupInterval,
	)

	// Launch each job in its own goroutine
	go w.runPeriodicJob(ctx, "hub-tfa-tokens",
		w.config.ExpiredHubTFATokensCleanupInterval,
		w.cleanupExpiredHubTFATokens)

	go w.runPeriodicJob(ctx, "hub-sessions",
		w.config.ExpiredHubSessionsCleanupInterval,
		w.cleanupExpiredHubSessions)
}

// runPeriodicJob runs a job function in a loop with the given interval.
func (w *RegionalWorker) runPeriodicJob(
	ctx context.Context,
	jobName string,
	interval time.Duration,
	jobFn func(context.Context),
) {
	if interval < time.Second {
		interval = time.Second // Minimum 1 second to avoid busy-looping
	}

	w.log.Debug("starting periodic job",
		"job", jobName,
		"interval", interval)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run job immediately on start
	jobFn(ctx)

	for {
		select {
		case <-ctx.Done():
			w.log.Debug("periodic job stopping", "job", jobName)
			return
		case <-ticker.C:
			jobFn(ctx)
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
