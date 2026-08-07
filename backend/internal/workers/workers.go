// Package workers runs the backend's periodic housekeeping jobs.
package workers

import (
	"context"
	"log/slog"
	"time"

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
	queries sqlc.Querier
	log     *slog.Logger
	jobs    []periodicJob
}

func New(db *pgxpool.Pool, log *slog.Logger, config Config) *Worker {
	w := &Worker{
		queries: sqlc.New(db),
		log:     log.With("component", "workers"),
	}
	w.jobs = []periodicJob{
		{
			name:     "delete-expired-admin-sessions",
			interval: config.DeleteExpiredAdminSessionsInterval,
			run:      w.deleteExpiredAdminSessions,
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
		log.Error("invalid interval", "interval", job.interval)
		return
	}

	for {
		if ctx.Err() != nil {
			return
		}
		if err := job.run(ctx); err != nil && ctx.Err() == nil {
			log.Error("job failed", "error", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(job.interval):
		}
	}
}
