package workers

import (
	"bytes"
	"context"
	"log/slog"
	"testing"
)

type idempotencyStubQuerier struct {
	*ephemeralStubQuerier
}

func (s *idempotencyStubQuerier) PruneExpiredIdempotency(
	context.Context,
) (int64, error) {
	return s.result("idempotency")
}

func TestPruneIdempotencyLogsDeletedRows(t *testing.T) {
	var logs bytes.Buffer
	queries := &idempotencyStubQuerier{ephemeralStubQuerier: &ephemeralStubQuerier{}}
	worker := newTestWorker(slog.New(slog.NewTextHandler(&logs, nil)))
	worker.queries = queries

	if err := worker.pruneIdempotency(context.Background()); err != nil {
		t.Fatalf("pruneIdempotency() = %v", err)
	}
	if !bytes.Contains(logs.Bytes(), []byte("count=1")) {
		t.Fatalf("missing deletion count: %q", logs.String())
	}
}

func TestPruneIdempotencyWrapsErrors(t *testing.T) {
	queries := &idempotencyStubQuerier{
		ephemeralStubQuerier: &ephemeralStubQuerier{failAt: "idempotency"},
	}
	worker := newTestWorker(slog.Default())
	worker.queries = queries

	err := worker.pruneIdempotency(context.Background())
	if err == nil || err.Error() !=
		"prune expired idempotency rows: database unavailable" {
		t.Fatalf("pruneIdempotency() = %v", err)
	}
}
