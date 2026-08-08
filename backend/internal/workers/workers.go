// Package workers runs the backend's periodic housekeeping jobs.
package workers

import (
	"context"
	"log/slog"
	"time"

	"backend/internal/appconfig"
	"backend/internal/db/sqlc"

	"github.com/jackc/pgx/v5/pgxpool"
)

type periodicJob struct {
	name     string
	interval time.Duration
	run      func(context.Context) error
}

// Worker owns the dependencies and periodic jobs for the worker process.
type Worker struct {
	queries           sqlc.Querier
	log               *slog.Logger
	retryBackoffLimit time.Duration
	jobs              []periodicJob
}

func New(db *pgxpool.Pool, log *slog.Logger, config appconfig.Workers) *Worker {
	w := &Worker{
		queries:           sqlc.New(db),
		log:               log,
		retryBackoffLimit: config.RetryBackoffLimit,
	}
	w.jobs = []periodicJob{
		{
			name:     "prune-admin-sessions",
			interval: config.PruneAdminSessionsTimer,
			run:      w.pruneAdminSessions,
		},
	}
	return w
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
			log.Error(
				"job failed",
				"event", "worker_job_error",
				"error", err,
			)
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
