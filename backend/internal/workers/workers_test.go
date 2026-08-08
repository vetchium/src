package workers

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"

	"backend/internal/appconfig"
)

func TestNewUsesConfiguredJobInterval(t *testing.T) {
	const interval = 15 * time.Minute
	const retryBackoffLimit = 30 * time.Second
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	worker := New(nil, log, appconfig.Workers{
		RetryBackoffLimit:       retryBackoffLimit,
		PruneAdminSessionsTimer: interval,
	})

	if len(worker.jobs) != 1 {
		t.Fatalf("jobs = %d, want 1", len(worker.jobs))
	}
	if got := worker.jobs[0].interval; got != interval {
		t.Fatalf("job interval = %s, want %s", got, interval)
	}
	if worker.retryBackoffLimit != retryBackoffLimit {
		t.Fatalf(
			"retry backoff limit = %s, want %s",
			worker.retryBackoffLimit, retryBackoffLimit,
		)
	}
}

func TestRunStartsJobsIndependently(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	blocked := make(chan struct{})
	secondJobRan := make(chan struct{})
	worker := newTestWorker(slog.New(slog.NewTextHandler(io.Discard, nil)))
	worker.jobs = []periodicJob{
		{
			name:     "blocked",
			interval: time.Hour,
			run: func(ctx context.Context) error {
				close(blocked)
				<-ctx.Done()
				return ctx.Err()
			},
		},
		{
			name:     "second",
			interval: time.Hour,
			run: func(context.Context) error {
				close(secondJobRan)
				return nil
			},
		},
	}

	worker.Run(ctx)

	select {
	case <-blocked:
	case <-time.After(time.Second):
		t.Fatal("blocking job did not start")
	}
	select {
	case <-secondJobRan:
	case <-time.After(time.Second):
		t.Fatal("second job was blocked by the first job")
	}
}

func TestRunReturnsImmediately(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	worker := newTestWorker(slog.New(slog.NewTextHandler(io.Discard, nil)))
	worker.jobs = []periodicJob{{
		name:     "blocked",
		interval: time.Hour,
		run: func(ctx context.Context) error {
			<-ctx.Done()
			return ctx.Err()
		},
	}}

	returned := make(chan struct{})
	go func() {
		worker.Run(ctx)
		close(returned)
	}()

	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("Run blocked on a job")
	}
}

func TestRunPeriodicJobRunsImmediatelyAndOnInterval(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var runs atomic.Int32
	worker := newTestWorker(slog.New(slog.NewTextHandler(io.Discard, nil)))
	job := periodicJob{
		name:     "counting",
		interval: time.Millisecond,
		run: func(context.Context) error {
			if runs.Add(1) == 3 {
				cancel()
			}
			return nil
		},
	}

	worker.runPeriodicJob(ctx, job)

	if got := runs.Load(); got != 3 {
		t.Fatalf("runs = %d, want 3", got)
	}
}

func TestRunPeriodicJobWaitsAfterLongRun(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	const interval = 30 * time.Millisecond
	var runs int
	var firstRunFinished time.Time
	var waitAfterFirstRun time.Duration
	worker := newTestWorker(slog.New(slog.NewTextHandler(io.Discard, nil)))
	job := periodicJob{
		name:     "slow",
		interval: interval,
		run: func(context.Context) error {
			runs++
			if runs == 1 {
				time.Sleep(2 * interval)
				firstRunFinished = time.Now()
				return nil
			}
			waitAfterFirstRun = time.Since(firstRunFinished)
			cancel()
			return nil
		},
	}

	worker.runPeriodicJob(ctx, job)

	if waitAfterFirstRun < interval {
		t.Fatalf(
			"wait after long run = %s, want at least %s",
			waitAfterFirstRun, interval,
		)
	}
}

func TestRunPeriodicJobLogsErrorAndContinues(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var logs bytes.Buffer
	var runs atomic.Int32
	worker := newTestWorker(slog.New(slog.NewTextHandler(&logs, nil)))
	job := periodicJob{
		name:     "failing",
		interval: time.Millisecond,
		run: func(context.Context) error {
			if runs.Add(1) == 2 {
				cancel()
			}
			return errors.New("transient database error")
		},
	}

	worker.runPeriodicJob(ctx, job)

	if got := runs.Load(); got != 2 {
		t.Fatalf("runs = %d, want 2", got)
	}
	if !bytes.Contains(logs.Bytes(), []byte("transient database error")) {
		t.Fatalf("log = %q, want the job error", logs.String())
	}
	if !bytes.Contains(logs.Bytes(), []byte("event=worker_job_error")) {
		t.Fatalf("log = %q, want worker_job_error event", logs.String())
	}
}

func TestRunPeriodicJobLogsCancellationError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var logs bytes.Buffer
	worker := newTestWorker(slog.New(slog.NewTextHandler(&logs, nil)))
	job := periodicJob{
		name:     "cancelled",
		interval: time.Hour,
		run: func(context.Context) error {
			cancel()
			return context.Canceled
		},
	}

	worker.runPeriodicJob(ctx, job)

	wantedLogs := []string{
		"event=worker_job_stopped",
		"error=\"context canceled\"",
	}
	for _, want := range wantedLogs {
		if !bytes.Contains(logs.Bytes(), []byte(want)) {
			t.Errorf("log = %q, want %q", logs.String(), want)
		}
	}
}

func TestRunPeriodicJobRejectsInvalidInterval(t *testing.T) {
	var logs bytes.Buffer
	var runs atomic.Int32
	worker := newTestWorker(slog.New(slog.NewTextHandler(&logs, nil)))
	job := periodicJob{
		name:     "misconfigured",
		interval: 0,
		run: func(context.Context) error {
			runs.Add(1)
			return nil
		},
	}

	worker.runPeriodicJob(context.Background(), job)

	if got := runs.Load(); got != 0 {
		t.Fatalf("runs = %d, want 0", got)
	}
	if !bytes.Contains(logs.Bytes(), []byte("invalid interval")) {
		t.Fatalf("log = %q, want invalid interval error", logs.String())
	}
}

func TestNextBackoffStartsAtOneSecondAndCapsAtLimit(t *testing.T) {
	const limit = 2500 * time.Millisecond
	backoff := nextBackoff(0, limit)
	if backoff != time.Second {
		t.Fatalf("initial backoff = %s, want 1s", backoff)
	}
	backoff = nextBackoff(backoff, limit)
	if backoff != 2*time.Second {
		t.Fatalf("second backoff = %s, want 2s", backoff)
	}
	backoff = nextBackoff(backoff, limit)
	if backoff != limit {
		t.Fatalf("capped backoff = %s, want %s", backoff, limit)
	}
}

func newTestWorker(log *slog.Logger) *Worker {
	return &Worker{log: log, retryBackoffLimit: time.Millisecond}
}
