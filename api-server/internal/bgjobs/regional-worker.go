package bgjobs

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	orgdomains "vetchium-api-server.typespec/org-domains"
)

// RegionalWorker runs background jobs for a regional database.
// This includes cleanup of expired tokens and sessions.
//
// IMPORTANT: There should be exactly ONE RegionalWorker instance per region,
// following the same pattern as the email worker.
type RegionalWorker struct {
	queries     *regionaldb.Queries
	globalDB    *globaldb.Queries
	pool        *pgxpool.Pool // For transaction support
	config      *RegionalBgJobsConfig
	log         *slog.Logger
	regionName  string
	environment string // "DEV" or "PROD"
}

// NewRegionalWorker creates a new regional background jobs worker
func NewRegionalWorker(
	queries *regionaldb.Queries,
	globalDB *globaldb.Queries,
	pool *pgxpool.Pool,
	config *RegionalBgJobsConfig,
	log *slog.Logger,
	regionName string,
	environment string,
) *RegionalWorker {
	return &RegionalWorker{
		queries:     queries,
		globalDB:    globalDB,
		pool:        pool,
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
		"org_invitation_cleanup_interval", w.config.ExpiredOrgInvitationTokensCleanupInterval,
		"audit_log_retention", w.config.AuditLogRetention,
		"audit_log_purge_interval", w.config.AuditLogPurgeInterval,
		"expire_openings_interval", w.config.ExpireOpeningsInterval,
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

	go w.runPeriodicJob(ctx, "org-invitation-tokens",
		w.config.ExpiredOrgInvitationTokensCleanupInterval,
		w.cleanupExpiredOrgInvitationTokens)

	go w.runPeriodicJob(ctx, "org-domain-verification",
		w.config.OrgDomainVerificationInterval,
		w.verifyOrgDomains)

	go w.runPeriodicJob(ctx, "audit-logs",
		w.config.AuditLogPurgeInterval,
		w.purgeExpiredAuditLogs)

	go w.runPeriodicJob(ctx, "expire-pending-work-emails",
		w.config.ExpirePendingWorkEmailsInterval,
		w.expirePendingWorkEmails)

	go w.runPeriodicJob(ctx, "manage-active-work-emails",
		w.config.ManageActiveWorkEmailsInterval,
		w.manageActiveWorkEmails)

	go w.runPeriodicJob(ctx, "expire-openings",
		w.config.ExpireOpeningsInterval,
		w.expireOpenings)
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

func (w *RegionalWorker) cleanupExpiredOrgInvitationTokens(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	err := w.queries.DeleteExpiredOrgInvitationTokens(ctx)
	if err != nil {
		w.log.Error("failed to cleanup expired org invitation tokens", "error", err)
		return
	}
	w.log.Debug("cleaned up expired org invitation tokens")
}

func (w *RegionalWorker) verifyOrgDomains(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	cutoff := time.Now().AddDate(0, 0, -orgdomains.PeriodicReverificationCycle)
	domains, err := w.queries.GetOrgDomainsForReverification(ctx, pgtype.Timestamptz{Time: cutoff, Valid: true})
	if err != nil {
		w.log.Error("failed to get org domains for reverification", "error", err)
		return
	}

	w.log.Info("starting org domain reverification", "count", len(domains))

	for _, d := range domains {
		if ctx.Err() != nil {
			return
		}

		if w.checkDNS(d.Domain, d.VerificationToken) {
			err = w.queries.UpdateOrgDomainStatus(ctx, regionaldb.UpdateOrgDomainStatusParams{
				Domain:              d.Domain,
				Status:              regionaldb.DomainVerificationStatusVERIFIED,
				LastVerifiedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
				ConsecutiveFailures: 0,
				FailingSince:        pgtype.Timestamptz{Valid: false}, // clear on recovery
			})
			if err != nil {
				w.log.Error("failed to update org domain status after verification", "domain", d.Domain, "error", err)
			} else {
				w.log.Info("org domain reverified successfully", "domain", d.Domain)
			}
		} else {
			newFailures := d.ConsecutiveFailures + 1
			newStatus := d.Status
			var failingSince pgtype.Timestamptz

			if newFailures >= orgdomains.FailureThreshold && d.Status == regionaldb.DomainVerificationStatusVERIFIED {
				newStatus = regionaldb.DomainVerificationStatusFAILING
			}

			// Track when the failure streak began; don't overwrite once set.
			if newStatus == regionaldb.DomainVerificationStatusFAILING {
				if d.FailingSince.Valid {
					failingSince = d.FailingSince
				} else {
					failingSince = pgtype.Timestamptz{Time: time.Now(), Valid: true}
				}
			} else {
				failingSince = d.FailingSince
			}

			err = w.queries.UpdateOrgDomainStatus(ctx, regionaldb.UpdateOrgDomainStatusParams{
				Domain:              d.Domain,
				Status:              newStatus,
				LastVerifiedAt:      d.LastVerifiedAt,
				ConsecutiveFailures: newFailures,
				FailingSince:        failingSince,
			})
			if err != nil {
				w.log.Error("failed to update org domain failure count", "domain", d.Domain, "error", err)
			} else {
				w.log.Info("org domain reverification failed", "domain", d.Domain, "failures", newFailures, "status", newStatus)
			}
		}
	}

	// After processing all domains, check for primary domains that need failover.
	w.promoteFailedPrimaryDomains(ctx)
}

// promoteFailedPrimaryDomains finds orgs whose primary domain has been FAILING for
// longer than PrimaryFailoverGrace and promotes the oldest available VERIFIED domain.
func (w *RegionalWorker) promoteFailedPrimaryDomains(ctx context.Context) {
	graceCutoff := time.Now().AddDate(0, 0, -orgdomains.PrimaryFailoverGrace)
	candidates, err := w.queries.GetFailingPrimaryDomainsForFailover(ctx,
		pgtype.Timestamptz{Time: graceCutoff, Valid: true},
	)
	if err != nil {
		w.log.Error("failed to get failing primary domain candidates", "error", err)
		return
	}

	for _, c := range candidates {
		if ctx.Err() != nil {
			return
		}

		// Confirm this domain is actually primary in global DB (source of truth).
		isPrimary, err := w.globalDB.IsDomainPrimaryForOrg(ctx, globaldb.IsDomainPrimaryForOrgParams{
			Domain: c.Domain,
			OrgID:  c.OrgID,
		})
		if err != nil || !isPrimary {
			continue
		}

		// Find all non-primary domains for this org from global DB.
		nonPrimaryDomains, err := w.globalDB.GetNonPrimaryDomainsByOrg(ctx, c.OrgID)
		if err != nil {
			w.log.Error("failed to get non-primary domains for failover", "org_id", c.OrgID, "error", err)
			continue
		}

		// Pick the first one that is VERIFIED in regional DB (oldest by global created_at).
		promoted := ""
		for _, candidate := range nonPrimaryDomains {
			domainRecord, err := w.queries.GetOrgDomain(ctx, candidate)
			if err != nil {
				continue
			}
			if domainRecord.Status == regionaldb.DomainVerificationStatusVERIFIED {
				promoted = candidate
				break
			}
		}

		if promoted == "" {
			w.log.Error("CONSISTENCY_ALERT: primary domain FAILING past grace period but no VERIFIED replacement found",
				"org_id", c.OrgID, "failing_domain", c.Domain)
			continue
		}

		if err := w.globalDB.SetPrimaryDomain(ctx, globaldb.SetPrimaryDomainParams{
			OrgID:  c.OrgID,
			Domain: promoted,
		}); err != nil {
			w.log.Error("failed to promote replacement primary domain",
				"org_id", c.OrgID, "new_primary", promoted, "error", err)
		} else {
			w.log.Info("primary domain auto-promoted due to sustained failure",
				"org_id", c.OrgID, "old_primary", c.Domain, "new_primary", promoted)
		}
	}
}

func (w *RegionalWorker) purgeExpiredAuditLogs(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	retention := pgtype.Interval{Microseconds: w.config.AuditLogRetention.Microseconds(), Valid: true}
	err := w.queries.DeleteExpiredAuditLogs(ctx, retention)
	if err != nil {
		w.log.Error("failed to purge expired audit logs", "error", err)
		return
	}
	w.log.Debug("purged expired audit logs")
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
