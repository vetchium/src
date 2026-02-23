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
		"admin_password_reset_cleanup_interval", w.config.ExpiredAdminPasswordResetTokensCleanupInterval,
		"admin_invitation_cleanup_interval", w.config.ExpiredAdminInvitationTokensCleanupInterval,
		"hub_signup_tokens_cleanup_interval", w.config.ExpiredHubSignupTokensCleanupInterval,
		"org_signup_tokens_cleanup_interval", w.config.ExpiredOrgSignupTokensCleanupInterval,
		"agency_signup_tokens_cleanup_interval", w.config.ExpiredAgencySignupTokensCleanupInterval,
	)

	// Launch each job in its own goroutine
	go w.runPeriodicJob(ctx, "admin-tfa-tokens",
		w.config.ExpiredAdminTFATokensCleanupInterval,
		w.cleanupExpiredAdminTFATokens)

	go w.runPeriodicJob(ctx, "admin-sessions",
		w.config.ExpiredAdminSessionsCleanupInterval,
		w.cleanupExpiredAdminSessions)

	go w.runPeriodicJob(ctx, "admin-password-reset-tokens",
		w.config.ExpiredAdminPasswordResetTokensCleanupInterval,
		w.cleanupExpiredAdminPasswordResetTokens)

	go w.runPeriodicJob(ctx, "admin-invitation-tokens",
		w.config.ExpiredAdminInvitationTokensCleanupInterval,
		w.cleanupExpiredAdminInvitationTokens)

	go w.runPeriodicJob(ctx, "hub-signup-tokens",
		w.config.ExpiredHubSignupTokensCleanupInterval,
		w.cleanupExpiredHubSignupTokens)

	go w.runPeriodicJob(ctx, "org-signup-tokens",
		w.config.ExpiredOrgSignupTokensCleanupInterval,
		w.cleanupExpiredOrgSignupTokens)

	go w.runPeriodicJob(ctx, "agency-signup-tokens",
		w.config.ExpiredAgencySignupTokensCleanupInterval,
		w.cleanupExpiredAgencySignupTokens)
}

// runPeriodicJob runs a job function in a loop with the given interval.
func (w *GlobalWorker) runPeriodicJob(
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

func (w *GlobalWorker) cleanupExpiredOrgSignupTokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredOrgSignupTokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired org signup tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired org signup tokens")
}

func (w *GlobalWorker) cleanupExpiredAgencySignupTokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredAgencySignupTokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired agency signup tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired agency signup tokens")
}

func (w *GlobalWorker) cleanupExpiredAdminPasswordResetTokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredAdminPasswordResetTokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired admin password reset tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired admin password reset tokens")
}

func (w *GlobalWorker) cleanupExpiredAdminInvitationTokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredAdminInvitationTokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired admin invitation tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired admin invitation tokens")
}
