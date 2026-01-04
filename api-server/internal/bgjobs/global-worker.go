package bgjobs

import (
	"context"
	"log/slog"
	"time"

	"vetchium-api-server.gomodule/internal/db/globaldb"
)

// GlobalWorker runs background jobs for the global database.
// This includes cleanup of expired tokens and sessions.
type GlobalWorker struct {
	queries *globaldb.Queries
	config  *GlobalBgJobsConfig
	log     *slog.Logger
}

// NewGlobalWorker creates a new global background jobs worker
func NewGlobalWorker(
	queries *globaldb.Queries,
	config *GlobalBgJobsConfig,
	log *slog.Logger,
) *GlobalWorker {
	return &GlobalWorker{
		queries: queries,
		config:  config,
		log:     log.With("component", "global-bgjobs-worker"),
	}
}

// Run starts the global background jobs worker. It launches goroutines for each
// job and returns immediately. Each job runs in its own goroutine with an
// independent ticker to prevent starvation. Goroutines exit when ctx is cancelled.
func (w *GlobalWorker) Run(ctx context.Context) {
	w.log.Info("starting global background jobs worker",
		"admin_tfa_cleanup_interval", w.config.ExpiredAdminTFATokensCleanupInterval,
		"admin_sessions_cleanup_interval", w.config.ExpiredAdminSessionsCleanupInterval,
		"hub_signup_tokens_cleanup_interval", w.config.ExpiredHubSignupTokensCleanupInterval,
	)

	// Launch each job in its own goroutine
	go w.runPeriodicJob(ctx, "admin-tfa-tokens",
		w.config.ExpiredAdminTFATokensCleanupInterval,
		w.cleanupExpiredAdminTFATokens)

	go w.runPeriodicJob(ctx, "admin-sessions",
		w.config.ExpiredAdminSessionsCleanupInterval,
		w.cleanupExpiredAdminSessions)

	go w.runPeriodicJob(ctx, "hub-signup-tokens",
		w.config.ExpiredHubSignupTokensCleanupInterval,
		w.cleanupExpiredHubSignupTokens)
}

// runPeriodicJob runs a job function in a loop with the given interval.
// The ticker interval is set to half the configured interval to ensure more
// responsive execution.
func (w *GlobalWorker) runPeriodicJob(
	ctx context.Context,
	jobName string,
	interval time.Duration,
	jobFn func(context.Context),
) {
	// Use half the interval for more responsive execution
	tickerInterval := interval / 2
	if tickerInterval < time.Second {
		tickerInterval = time.Second // Minimum 1 second to avoid busy-looping
	}

	w.log.Debug("starting periodic job",
		"job", jobName,
		"configured_interval", interval,
		"ticker_interval", tickerInterval)

	ticker := time.NewTicker(tickerInterval)
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

func (w *GlobalWorker) cleanupExpiredAdminTFATokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredAdminTFATokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired admin TFA tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired admin TFA tokens")
}

func (w *GlobalWorker) cleanupExpiredAdminSessions(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredAdminSessions(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired admin sessions", "error", err)
		return
	}
	w.log.Debug("cleaned up expired admin sessions")
}

func (w *GlobalWorker) cleanupExpiredHubSignupTokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredHubSignupTokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired hub signup tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired hub signup tokens")
}
