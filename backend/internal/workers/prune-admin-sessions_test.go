package workers

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"testing"

	"backend/internal/db/sqlc"
)

// stubQuerier implements only the queries a test needs; the embedded interface
// panics on anything else.
type stubQuerier struct {
	sqlc.Querier
	deleteExpiredAdminSessions func(context.Context) (int64, error)
}

func (s stubQuerier) DeleteExpiredAdminSessions(ctx context.Context) (int64, error) {
	return s.deleteExpiredAdminSessions(ctx)
}

func TestPruneAdminSessionsLogsDeletedCount(t *testing.T) {
	var logs bytes.Buffer
	worker := newTestWorker(slog.New(slog.NewTextHandler(&logs, nil)))
	worker.queries = stubQuerier{
		deleteExpiredAdminSessions: func(context.Context) (int64, error) { return 2, nil },
	}

	if err := worker.pruneAdminSessions(context.Background()); err != nil {
		t.Fatalf("pruneAdminSessions() = %v, want nil", err)
	}
	if !bytes.Contains(logs.Bytes(), []byte("count=2")) {
		t.Fatalf("log = %q, want the deleted count", logs.String())
	}
}

func TestPruneAdminSessionsStaysQuietWhenNothingExpired(t *testing.T) {
	var logs bytes.Buffer
	worker := newTestWorker(slog.New(slog.NewTextHandler(&logs, nil)))
	worker.queries = stubQuerier{
		deleteExpiredAdminSessions: func(context.Context) (int64, error) { return 0, nil },
	}

	if err := worker.pruneAdminSessions(context.Background()); err != nil {
		t.Fatalf("pruneAdminSessions() = %v, want nil", err)
	}
	if logs.Len() != 0 {
		t.Fatalf("log = %q, want no output", logs.String())
	}
}

func TestPruneAdminSessionsWrapsQueryError(t *testing.T) {
	wantErr := errors.New("transient database error")
	worker := newTestWorker(slog.Default())
	worker.queries = stubQuerier{
		deleteExpiredAdminSessions: func(context.Context) (int64, error) { return 0, wantErr },
	}

	err := worker.pruneAdminSessions(context.Background())
	if !errors.Is(err, wantErr) {
		t.Fatalf("pruneAdminSessions() = %v, want %v", err, wantErr)
	}
}
