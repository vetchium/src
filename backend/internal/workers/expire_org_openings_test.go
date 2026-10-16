package workers

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"backend/internal/db/sqlc"
)

type openingExpiryStub struct {
	counts []int32
	calls  int
	err    error
}

func (s *openingExpiryStub) ExpireOrgOpenings(
	_ context.Context, tenantID string,
) (sqlc.ExpireOrgOpeningsRow, error) {
	if tenantID != "test" {
		panic("wrong tenant")
	}
	s.calls++
	if s.err != nil {
		return sqlc.ExpireOrgOpeningsRow{}, s.err
	}
	return sqlc.ExpireOrgOpeningsRow{ExpiredCount: s.counts[s.calls-1]}, nil
}

func TestExpireOrgOpeningsDrainsFullBatch(t *testing.T) {
	stub := &openingExpiryStub{counts: []int32{100, 1}}
	w := &Worker{
		openingExpiryQueries: stub,
		tenantID:             "test",
		log:                  slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if err := w.expireOrgOpenings(context.Background()); err != nil {
		t.Fatal(err)
	}
	if stub.calls != 2 {
		t.Fatalf("query calls = %d, want 2", stub.calls)
	}
}

func TestExpireOrgOpeningsBoundsOneRun(t *testing.T) {
	counts := make([]int32, maxOpeningExpiryBatches)
	for i := range counts {
		counts[i] = openingExpiryBatchSize
	}
	stub := &openingExpiryStub{counts: counts}
	w := &Worker{
		openingExpiryQueries: stub,
		tenantID:             "test",
		log:                  slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if err := w.expireOrgOpenings(context.Background()); err != nil {
		t.Fatal(err)
	}
	if stub.calls != maxOpeningExpiryBatches {
		t.Fatalf("query calls = %d, want %d", stub.calls, maxOpeningExpiryBatches)
	}
}

func TestExpireOrgOpeningsReturnsQueryError(t *testing.T) {
	want := errors.New("database unavailable")
	w := &Worker{
		openingExpiryQueries: &openingExpiryStub{err: want},
		tenantID:             "test",
		log:                  slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if err := w.expireOrgOpenings(context.Background()); !errors.Is(err, want) {
		t.Fatalf("error = %v, want %v", err, want)
	}
}
