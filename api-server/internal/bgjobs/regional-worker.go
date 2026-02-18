package bgjobs

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	employerdomains "vetchium-api-server.typespec/employer-domains"
)

// RegionalWorker runs background jobs for a regional database.
// This includes cleanup of expired tokens and sessions.
//
// IMPORTANT: There should be exactly ONE RegionalWorker instance per region,
// following the same pattern as the email worker.
type RegionalWorker struct {
	queries     *regionaldb.Queries
	config      *RegionalBgJobsConfig
	log         *slog.Logger
	regionName  string
	environment string // "DEV" or "PROD"
}

// NewRegionalWorker creates a new regional background jobs worker
func NewRegionalWorker(
	queries *regionaldb.Queries,
	config *RegionalBgJobsConfig,
	log *slog.Logger,
	regionName string,
	environment string,
) *RegionalWorker {
	return &RegionalWorker{
		queries:     queries,
		config:      config,
		log:         log.With("component", "regional-bgjobs-worker", "region", regionName),
		regionName:  regionName,
		environment: environment,
	}
}

// Run starts the regional background jobs worker. It launches goroutines for each
// job and returns immediately. Each job runs in its own goroutine with an
// independent ticker to prevent starvation. Goroutines exit when ctx is cancelled.
func (w *RegionalWorker) Run(ctx context.Context) {
	w.log.Info("starting regional background jobs worker",
		"hub_tfa_cleanup_interval", w.config.ExpiredHubTFATokensCleanupInterval,
		"hub_sessions_cleanup_interval", w.config.ExpiredHubSessionsCleanupInterval,
		"hub_password_reset_cleanup_interval", w.config.ExpiredHubPasswordResetTokensCleanupInterval,
		"hub_email_verification_cleanup_interval", w.config.ExpiredHubEmailVerificationTokensCleanupInterval,
		"org_tfa_cleanup_interval", w.config.ExpiredOrgTFATokensCleanupInterval,
		"org_sessions_cleanup_interval", w.config.ExpiredOrgSessionsCleanupInterval,
		"org_password_reset_cleanup_interval", w.config.ExpiredOrgPasswordResetTokensCleanupInterval,
		"agency_tfa_cleanup_interval", w.config.ExpiredAgencyTFATokensCleanupInterval,
		"agency_sessions_cleanup_interval", w.config.ExpiredAgencySessionsCleanupInterval,
		"agency_password_reset_cleanup_interval", w.config.ExpiredAgencyPasswordResetTokensCleanupInterval,
	)

	// Launch each job in its own goroutine
	go w.runPeriodicJob(ctx, "hub-tfa-tokens",
		w.config.ExpiredHubTFATokensCleanupInterval,
		w.cleanupExpiredHubTFATokens)

	go w.runPeriodicJob(ctx, "hub-sessions",
		w.config.ExpiredHubSessionsCleanupInterval,
		w.cleanupExpiredHubSessions)

	go w.runPeriodicJob(ctx, "hub-password-reset-tokens",
		w.config.ExpiredHubPasswordResetTokensCleanupInterval,
		w.cleanupExpiredHubPasswordResetTokens)

	go w.runPeriodicJob(ctx, "hub-email-verification-tokens",
		w.config.ExpiredHubEmailVerificationTokensCleanupInterval,
		w.cleanupExpiredHubEmailVerificationTokens)

	go w.runPeriodicJob(ctx, "org-tfa-tokens",
		w.config.ExpiredOrgTFATokensCleanupInterval,
		w.cleanupExpiredOrgTFATokens)

	go w.runPeriodicJob(ctx, "org-sessions",
		w.config.ExpiredOrgSessionsCleanupInterval,
		w.cleanupExpiredOrgSessions)

	go w.runPeriodicJob(ctx, "org-password-reset-tokens",
		w.config.ExpiredOrgPasswordResetTokensCleanupInterval,
		w.cleanupExpiredOrgPasswordResetTokens)

	go w.runPeriodicJob(ctx, "agency-tfa-tokens",
		w.config.ExpiredAgencyTFATokensCleanupInterval,
		w.cleanupExpiredAgencyTFATokens)

	go w.runPeriodicJob(ctx, "agency-sessions",
		w.config.ExpiredAgencySessionsCleanupInterval,
		w.cleanupExpiredAgencySessions)

	go w.runPeriodicJob(ctx, "agency-password-reset-tokens",
		w.config.ExpiredAgencyPasswordResetTokensCleanupInterval,
		w.cleanupExpiredAgencyPasswordResetTokens)

	go w.runPeriodicJob(ctx, "employer-domain-verification",
		w.config.EmployerDomainVerificationInterval,
		w.verifyEmployerDomains)

	go w.runPeriodicJob(ctx, "agency-domain-verification",
		w.config.AgencyDomainVerificationInterval,
		w.verifyAgencyDomains)
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

func (w *RegionalWorker) cleanupExpiredOrgTFATokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredOrgTFATokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired org TFA tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired org TFA tokens")
}

func (w *RegionalWorker) cleanupExpiredOrgSessions(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredOrgSessions(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired org sessions", "error", err)
		return
	}
	w.log.Debug("cleaned up expired org sessions")
}

func (w *RegionalWorker) cleanupExpiredAgencyTFATokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredAgencyTFATokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired agency TFA tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired agency TFA tokens")
}

func (w *RegionalWorker) cleanupExpiredAgencySessions(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredAgencySessions(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired agency sessions", "error", err)
		return
	}
	w.log.Debug("cleaned up expired agency sessions")
}

func (w *RegionalWorker) cleanupExpiredHubPasswordResetTokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredHubPasswordResetTokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired hub password reset tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired hub password reset tokens")
}

func (w *RegionalWorker) cleanupExpiredHubEmailVerificationTokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredHubEmailVerificationTokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired hub email verification tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired hub email verification tokens")
}

func (w *RegionalWorker) cleanupExpiredOrgPasswordResetTokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredOrgPasswordResetTokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired org password reset tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired org password reset tokens")
}

func (w *RegionalWorker) cleanupExpiredAgencyPasswordResetTokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredAgencyPasswordResetTokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired agency password reset tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired agency password reset tokens")
}

func (w *RegionalWorker) verifyEmployerDomains(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	cutoff := time.Now().AddDate(0, 0, -employerdomains.VerificationIntervalDays)
	domains, err := w.queries.GetEmployerDomainsForReverification(ctx, pgtype.Timestamp{Time: cutoff, Valid: true})
	if err != nil {
		w.log.Error("failed to get employer domains for reverification", "error", err)
		return
	}

	w.log.Info("starting employer domain reverification", "count", len(domains))

	for _, d := range domains {
		if ctx.Err() != nil {
			return
		}

		verified := w.checkDNS(d.Domain, d.VerificationToken)

		if verified {
			err = w.queries.UpdateEmployerDomainStatus(ctx, regionaldb.UpdateEmployerDomainStatusParams{
				Domain:              d.Domain,
				Status:              regionaldb.DomainVerificationStatusVERIFIED,
				LastVerifiedAt:      pgtype.Timestamp{Time: time.Now(), Valid: true},
				ConsecutiveFailures: 0,
			})
			if err != nil {
				w.log.Error("failed to update employer domain status after verification", "domain", d.Domain, "error", err)
			} else {
				w.log.Info("employer domain reverified successfully", "domain", d.Domain)
			}
		} else {
			newFailures := d.ConsecutiveFailures + 1
			newStatus := d.Status
			if newFailures >= employerdomains.MaxConsecutiveFailures && d.Status == regionaldb.DomainVerificationStatusVERIFIED {
				newStatus = regionaldb.DomainVerificationStatusFAILING
			}
			err = w.queries.UpdateEmployerDomainStatus(ctx, regionaldb.UpdateEmployerDomainStatusParams{
				Domain:              d.Domain,
				Status:              newStatus,
				LastVerifiedAt:      d.LastVerifiedAt,
				ConsecutiveFailures: newFailures,
			})
			if err != nil {
				w.log.Error("failed to update employer domain failure count", "domain", d.Domain, "error", err)
			} else {
				w.log.Info("employer domain reverification failed", "domain", d.Domain, "failures", newFailures, "status", newStatus)
			}
		}
	}
}

func (w *RegionalWorker) verifyAgencyDomains(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	cutoff := time.Now().AddDate(0, 0, -employerdomains.VerificationIntervalDays)
	domains, err := w.queries.GetAgencyDomainsForReverification(ctx, pgtype.Timestamp{Time: cutoff, Valid: true})
	if err != nil {
		w.log.Error("failed to get agency domains for reverification", "error", err)
		return
	}

	w.log.Info("starting agency domain reverification", "count", len(domains))

	for _, d := range domains {
		if ctx.Err() != nil {
			return
		}

		verified := w.checkDNS(d.Domain, d.VerificationToken)

		if verified {
			err = w.queries.UpdateAgencyDomainStatus(ctx, regionaldb.UpdateAgencyDomainStatusParams{
				Domain:              d.Domain,
				Status:              regionaldb.DomainVerificationStatusVERIFIED,
				LastVerifiedAt:      pgtype.Timestamp{Time: time.Now(), Valid: true},
				ConsecutiveFailures: 0,
			})
			if err != nil {
				w.log.Error("failed to update agency domain status after verification", "domain", d.Domain, "error", err)
			} else {
				w.log.Info("agency domain reverified successfully", "domain", d.Domain)
			}
		} else {
			newFailures := d.ConsecutiveFailures + 1
			newStatus := d.Status
			if newFailures >= employerdomains.MaxConsecutiveFailures && d.Status == regionaldb.DomainVerificationStatusVERIFIED {
				newStatus = regionaldb.DomainVerificationStatusFAILING
			}
			err = w.queries.UpdateAgencyDomainStatus(ctx, regionaldb.UpdateAgencyDomainStatusParams{
				Domain:              d.Domain,
				Status:              newStatus,
				LastVerifiedAt:      d.LastVerifiedAt,
				ConsecutiveFailures: newFailures,
			})
			if err != nil {
				w.log.Error("failed to update agency domain failure count", "domain", d.Domain, "error", err)
			} else {
				w.log.Info("agency domain reverification failed", "domain", d.Domain, "failures", newFailures, "status", newStatus)
			}
		}
	}
}

// checkDNS checks if the verification token is present in the DNS TXT record for the domain.
// In DEV environment, example.com domains are always treated as verified.
func (w *RegionalWorker) checkDNS(domain, expectedToken string) bool {
	// DEV bypass for example.com domains
	if w.environment == "DEV" && strings.HasSuffix(domain, "example.com") {
		w.log.Debug("DEV mode: skipping DNS check for example.com domain", "domain", domain)
		return true
	}

	dnsName := fmt.Sprintf("_vetchium-verify.%s", domain)
	txtRecords, err := net.LookupTXT(dnsName)
	if err != nil {
		w.log.Debug("DNS lookup failed during reverification", "domain", domain, "error", err)
		return false
	}

	for _, record := range txtRecords {
		if strings.TrimSpace(record) == expectedToken {
			return true
		}
	}
	return false
}
