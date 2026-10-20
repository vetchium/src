// Package workers runs the backend's periodic housekeeping jobs.
package workers

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/appconfig"
	"backend/internal/db/sqlc"
)

type periodicJob struct {
	name     string
	interval time.Duration
	run      func(context.Context) error
}

type HubSignupRecovery interface {
	Recover(context.Context) (int, error)
}

type HubEmailChangeRecovery interface {
	Recover(context.Context) (int, error)
}

// FederationCommandRecovery re-drives pending cross-tenant commands of every
// kind.
type FederationCommandRecovery interface {
	Recover(context.Context) (int, error)
}

// FederationEventDelivery drains this tenant's outbox of events for every
// destination principal, remote or local.
type FederationEventDelivery interface {
	Deliver(context.Context) (int, error)
}

// Worker owns the dependencies and periodic jobs for the worker process.
type Worker struct {
	queries                      sqlc.Querier
	hubEmailQueries              hubEmailQueries
	hubEmailDelivery             *HubEmailDelivery
	hubSignupRecovery            HubSignupRecovery
	hubEmailChangeRecovery       HubEmailChangeRecovery
	reconcileHubEmailChangeTimer time.Duration
	federationCommandTimer       time.Duration
	federationCommands           FederationCommandRecovery
	federationEventTimer         time.Duration
	federationEvents             FederationEventDelivery
	pictureQueries               pictureDeletionQueries
	pictureStore                 PictureStore
	logoStore                    LogoStore
	logoQueries                  logoDeletionQueries
	offerLetterStore             OfferLetterStore
	offerLetterQueries           offerLetterDeletionQueries
	offerExpiryDB                *pgxpool.Pool
	applicationDB                *pgxpool.Pool
	pictureDeletionInterval      time.Duration
	aliasReleaseQueries          aliasReleaseQueries
	aliasReleaseDirectory        AliasReleaseDirectory
	aliasReleaseInterval         time.Duration
	aliasChangeDB                *pgxpool.Pool
	aliasChangeQueries           aliasChangeQueries
	subscriptionTransactions     subscriptionTransactions
	hubSubscriptionNow           func() time.Time
	subscriptionExpiryQueries    subscriptionExpiryQueries
	openingExpiryQueries         openingExpiryQueries
	engagementExpiryDB           *pgxpool.Pool
	orgQueries                   orgEmailQueries
	orgs                         *orgJobs
	orgAI                        *orgAIJobs
	hubSubscriptionExpiryNow     func() time.Time
	log                          *slog.Logger
	tenantID                     string
	retryBackoffLimit            time.Duration
	jobs                         []periodicJob
}

func New(
	db *pgxpool.Pool,
	log *slog.Logger,
	tenantID string,
	config appconfig.Workers,
	hubEmailDelivery *HubEmailDelivery,
	hubSignupRecovery HubSignupRecovery,
	hubEmailChangeRecovery HubEmailChangeRecovery,
) *Worker {
	queries := sqlc.New(db)
	w := &Worker{
		queries:                      queries,
		hubEmailQueries:              queries,
		log:                          log,
		tenantID:                     tenantID,
		retryBackoffLimit:            config.RetryBackoffLimit,
		subscriptionTransactions:     poolSubscriptionTransactions{db: db},
		hubSignupRecovery:            hubSignupRecovery,
		hubEmailChangeRecovery:       hubEmailChangeRecovery,
		reconcileHubEmailChangeTimer: config.ReconcileHubEmailChangeTimer,
		federationCommandTimer:       config.DriveFederationCommandsTimer,
		federationEventTimer:         config.DeliverFederationEventsTimer,
		pictureQueries:               queries,
		logoQueries:                  queries,
		offerLetterQueries:           queries,
		offerExpiryDB:                db,
		applicationDB:                db,
		pictureDeletionInterval:      config.PruneEphemeralDataTimer,
		aliasReleaseQueries:          queries,
		aliasReleaseInterval:         config.ReconcileHubSignupTimer,
		aliasChangeDB:                db,
		aliasChangeQueries:           queries,
		subscriptionExpiryQueries:    queries,
		openingExpiryQueries:         queries,
		engagementExpiryDB:           db,
		orgQueries:                   queries,
	}
	w.jobs = []periodicJob{
		{
			name:     "prune-admin-sessions",
			interval: config.PruneAdminSessionsTimer,
			run:      w.pruneAdminSessions,
		},
		{
			name:     "prune-admin-ephemeral-data",
			interval: config.PruneEphemeralDataTimer,
			run:      w.pruneAdminEphemeralData,
		},
		{
			name:     "prune-idempotency",
			interval: config.PruneEphemeralDataTimer,
			run:      w.pruneIdempotency,
		},
		{
			name:     "advance-hub-subscriptions",
			interval: config.AdvanceHubSubscriptionsTimer,
			run:      w.advanceHubSubscriptions,
		},
		{
			name:     "expire-org-openings",
			interval: config.ExpireOrgOpeningsTimer,
			run:      w.expireOrgOpenings,
		},
		{
			name:     "expire-org-engagements",
			interval: config.ExpireOrgEngagementsTimer,
			run:      w.expireOrgEngagements,
		},
		{
			name:     "expire-application-offers",
			interval: config.ExpireApplicationOffersTimer,
			run:      w.expireApplicationOffers,
		},
		{
			name:     "retain-applications",
			interval: config.RetainApplicationsTimer,
			run:      w.retainApplications,
		},
		{
			name:     "refresh-hub-applications",
			interval: config.RefreshHubApplicationsTimer,
			run:      w.refreshHubApplications,
		},
	}
	if hubEmailDelivery != nil {
		w.hubEmailDelivery = hubEmailDelivery
		w.jobs = append(w.jobs, periodicJob{
			name:     "deliver-hub-email",
			interval: config.DeliverHubEmailTimer,
			run:      w.deliverHubEmail,
		})
		w.jobs = append(w.jobs, periodicJob{
			name:     "queue-hub-application-emails",
			interval: config.DeliverHubEmailTimer,
			run:      w.queueHubApplicationEmails,
		})
		// Shares the subscription advance job's cadence: both are periodic
		// Hub subscription bookkeeping, and this one also needs the outbox
		// encryption key that only arrives with hubEmailDelivery.
		w.jobs = append(w.jobs, periodicJob{
			name:     "warn-hub-subscription-expiry",
			interval: config.AdvanceHubSubscriptionsTimer,
			run:      w.warnHubSubscriptionExpiry,
		})
	}
	if hubSignupRecovery != nil {
		w.jobs = append(w.jobs, periodicJob{
			name: "reconcile-hub-signup", interval: config.ReconcileHubSignupTimer,
			run: w.reconcileHubSignup,
		})
	}
	if hubEmailChangeRecovery != nil {
		w.jobs = append(w.jobs, periodicJob{
			name:     "reconcile-hub-email-change",
			interval: w.reconcileHubEmailChangeTimer,
			run:      w.reconcileHubEmailChange,
		})
	}
	return w
}

func (w *Worker) EnablePictureDeletion(store PictureStore) {
	w.pictureStore = store
	w.jobs = append(w.jobs, periodicJob{
		name: "delete-hub-profile-pictures", interval: w.pictureDeletionInterval,
		run: w.deleteHubProfilePictures,
	})
}

func (w *Worker) EnableFederationCommands(recovery FederationCommandRecovery) {
	w.federationCommands = recovery
	w.jobs = append(w.jobs, periodicJob{
		name: "drive-federation-commands", interval: w.federationCommandTimer,
		run: w.driveFederationCommands,
	})
}

func (w *Worker) EnableFederationEvents(delivery FederationEventDelivery) {
	w.federationEvents = delivery
	w.jobs = append(w.jobs, periodicJob{
		name: "deliver-federation-events", interval: w.federationEventTimer,
		run: w.deliverFederationEvents,
	})
}

func (w *Worker) EnableAliasOperations(directory AliasReleaseDirectory) {
	w.aliasReleaseDirectory = directory
	w.jobs = append(w.jobs, periodicJob{
		name: "release-hub-aliases", interval: w.aliasReleaseInterval,
		run: w.releaseDowngradedHubAliases,
	})
	w.jobs = append(w.jobs, periodicJob{
		name: "complete-hub-alias-changes", interval: w.aliasReleaseInterval,
		run: w.completeHubAliasChanges,
	})
}

// Run starts every job in its own goroutine and returns immediately. A slow or
// blocked job therefore cannot delay any other job.
func (w *Worker) Run(ctx context.Context) {
	for _, job := range w.jobs {
		go w.runPeriodicJob(ctx, job)
	}
}

func (w *Worker) runPeriodicJob(ctx context.Context, job periodicJob) {
	log := w.log.With("job", job.name)
	if job.interval <= 0 {
		log.Error(
			"invalid interval",
			"event", "worker_configuration_error",
			"interval", job.interval,
		)
		return
	}
	if w.retryBackoffLimit <= 0 {
		log.Error(
			"invalid retry backoff limit",
			"event", "worker_configuration_error",
			"retryBackoffLimit", w.retryBackoffLimit,
		)
		return
	}

	var backoff time.Duration
	for {
		if contextErr := ctx.Err(); contextErr != nil {
			log.Info(
				"job stopped before run",
				"event", "worker_job_stopped",
				"error", contextErr,
			)
			return
		}
		err := job.run(ctx)
		if err != nil {
			if contextErr := ctx.Err(); contextErr != nil {
				log.Info(
					"job stopped after cancellation",
					"event", "worker_job_stopped",
					"error", err,
					"contextError", contextErr,
				)
				return
			}
			log.Error("job failed", "event", "worker_job_error", "error", err)
			backoff = nextBackoff(backoff, w.retryBackoffLimit)
		} else {
			backoff = 0
		}

		delay := job.interval
		if backoff > 0 {
			delay = backoff
		}
		if !wait(ctx, delay) {
			log.Info(
				"job stopped while waiting",
				"event", "worker_job_stopped",
				"error", ctx.Err(),
			)
			return
		}
	}
}

func nextBackoff(current, limit time.Duration) time.Duration {
	if current == 0 {
		return min(time.Second, limit)
	}
	return min(2*current, limit)
}

func wait(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
