package workers

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"backend/internal/appconfig"
)

type recoveryStub struct {
	resolved int
	err      error
	calls    int
}

func (r *recoveryStub) Recover(context.Context) (int, error) {
	r.calls++
	return r.resolved, r.err
}

func TestEnableFederationCommandsSchedulesRecovery(t *testing.T) {
	t.Parallel()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	worker := New(nil, log, "test", appconfig.Workers{
		DriveFederationCommandsTimer: 7 * time.Second,
	}, appconfig.Marketplace{}, nil, nil, nil)
	before := len(worker.jobs)
	recovery := &recoveryStub{resolved: 2}
	worker.EnableFederationCommands(recovery)
	if len(worker.jobs) != before+1 {
		t.Fatalf("jobs = %d, want %d", len(worker.jobs), before+1)
	}
	job := worker.jobs[len(worker.jobs)-1]
	if job.name != "drive-federation-commands" || job.interval != 7*time.Second {
		t.Fatalf("job = %q every %s", job.name, job.interval)
	}
	if err := job.run(context.Background()); err != nil || recovery.calls != 1 {
		t.Fatalf("run = %v after %d calls", err, recovery.calls)
	}
	recovery.err = errors.New("relay down")
	if err := job.run(context.Background()); err == nil {
		t.Fatal("recovery failure was not reported")
	}
}
