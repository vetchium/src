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

type deliveryStub struct {
	delivered int
	err       error
	calls     int
}

func (d *deliveryStub) Deliver(context.Context) (int, error) {
	d.calls++
	return d.delivered, d.err
}

func TestEnableFederationEventsSchedulesDelivery(t *testing.T) {
	t.Parallel()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	worker := New(nil, log, "test", appconfig.Workers{
		DeliverFederationEventsTimer: 3 * time.Second,
	}, appconfig.Marketplace{}, nil, nil, nil)
	before := len(worker.jobs)
	delivery := &deliveryStub{delivered: 2}
	worker.EnableFederationEvents(delivery)
	if len(worker.jobs) != before+1 {
		t.Fatalf("jobs = %d, want %d", len(worker.jobs), before+1)
	}
	job := worker.jobs[len(worker.jobs)-1]
	if job.name != "deliver-federation-events" || job.interval != 3*time.Second {
		t.Fatalf("job = %q every %s", job.name, job.interval)
	}
	if err := job.run(context.Background()); err != nil || delivery.calls != 1 {
		t.Fatalf("run = %v after %d calls", err, delivery.calls)
	}
	delivery.err = errors.New("database down")
	if err := job.run(context.Background()); err == nil {
		t.Fatal("delivery failure was not reported")
	}
}
