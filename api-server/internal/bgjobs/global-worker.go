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

// Run starts the global background jobs worker. It blocks until ctx is cancelled.
func (w *GlobalWorker) Run(ctx context.Context) {
	w.log.Info("starting global background jobs worker",
		"admin_tfa_cleanup_interval", w.config.ExpiredAdminTFATokensCleanupInterval,
		"admin_sessions_cleanup_interval", w.config.ExpiredAdminSessionsCleanupInterval,
		"hub_signup_tokens_cleanup_interval", w.config.ExpiredHubSignupTokensCleanupInterval,
	)

	// Create independent tickers for each cleanup job
	adminTFATicker := time.NewTicker(w.config.ExpiredAdminTFATokensCleanupInterval)
	adminSessionsTicker := time.NewTicker(w.config.ExpiredAdminSessionsCleanupInterval)
	hubSignupTokensTicker := time.NewTicker(w.config.ExpiredHubSignupTokensCleanupInterval)

	defer adminTFATicker.Stop()
	defer adminSessionsTicker.Stop()
	defer hubSignupTokensTicker.Stop()

	// Run cleanup immediately on start
	w.cleanupExpiredAdminTFATokens(ctx)
	w.cleanupExpiredAdminSessions(ctx)
	w.cleanupExpiredHubSignupTokens(ctx)

	for {
		select {
		case <-ctx.Done():
			w.log.Info("global background jobs worker stopping")
			return
		case <-adminTFATicker.C:
			w.cleanupExpiredAdminTFATokens(ctx)
		case <-adminSessionsTicker.C:
			w.cleanupExpiredAdminSessions(ctx)
		case <-hubSignupTokensTicker.C:
			w.cleanupExpiredHubSignupTokens(ctx)
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
