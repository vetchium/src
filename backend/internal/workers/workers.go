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

// Worker owns the dependencies and periodic jobs for the worker process.
type Worker struct {
	queries                   sqlc.Querier
	hubEmailQueries           hubEmailQueries
	hubEmailDelivery          *HubEmailDelivery
	hubSignupRecovery         HubSignupRecovery
	pictureQueries            pictureDeletionQueries
	pictureStore              PictureStore
	pictureDeletionInterval   time.Duration
	aliasReleaseQueries       aliasReleaseQueries
	aliasReleaseDirectory     AliasReleaseDirectory
	aliasReleaseInterval      time.Duration
	aliasChangeDB             *pgxpool.Pool
	aliasChangeQueries        aliasChangeQueries
	subscriptionTransactions  subscriptionTransactions
	hubSubscriptionNow        func() time.Time
	subscriptionExpiryQueries subscriptionExpiryQueries
	hubSubscriptionExpiryNow  func() time.Time
	log                       *slog.Logger
	tenantID                  string
	retryBackoffLimit         time.Duration
	jobs                      []periodicJob
}

func New(
	db *pgxpool.Pool,
	log *slog.Logger,
	tenantID string,
	config appconfig.Workers,
	hubEmailDelivery *HubEmailDelivery,
	hubSignupRecovery HubSignupRecovery,
) *Worker {
	queries := sqlc.New(db)
	w := &Worker{
		queries:                   queries,
		hubEmailQueries:           queries,
		log:                       log,
		tenantID:                  tenantID,
		retryBackoffLimit:         config.RetryBackoffLimit,
		subscriptionTransactions:  poolSubscriptionTransactions{db: db},
		hubSignupRecovery:         hubSignupRecovery,
		pictureQueries:            queries,
		pictureDeletionInterval:   config.PruneEphemeralDataTimer,
		aliasReleaseQueries:       queries,
		aliasReleaseInterval:      config.ReconcileHubSignupTimer,
		aliasChangeDB:             db,
		aliasChangeQueries:        queries,
		subscriptionExpiryQueries: queries,
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
	}
	if hubEmailDelivery != nil {
		w.hubEmailDelivery = hubEmailDelivery
		w.jobs = append(w.jobs, periodicJob{
			name:     "deliver-hub-email",
			interval: config.DeliverHubEmailTimer,
			run:      w.deliverHubEmail,
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
	return w
}

func (w *Worker) EnablePictureDeletion(store PictureStore) {
	w.pictureStore = store
	w.jobs = append(w.jobs, periodicJob{
		name: "delete-hub-profile-pictures", interval: w.pictureDeletionInterval,
		run: w.deleteHubProfilePictures,
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
