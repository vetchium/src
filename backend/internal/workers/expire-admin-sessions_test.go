package workers

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"
)

type expiredSessionStoreStub struct {
	delete func(context.Context) (int64, error)
}

func (s expiredSessionStoreStub) DeleteExpiredAdminSessions(ctx context.Context) (int64, error) {
	return s.delete(ctx)
}

func TestRunExpireAdminSessionsDeletesAtStartupAndOnTick(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	called := make(chan struct{}, 2)
	store := expiredSessionStoreStub{delete: func(context.Context) (int64, error) {
		select {
		case called <- struct{}{}:
		default:
		}
		return 2, nil
	}}
	go func() {
		defer close(done)
		RunExpireAdminSessions(ctx, store, slog.New(slog.NewTextHandler(io.Discard, nil)), time.Millisecond)
	}()

	for call := 1; call <= 2; call++ {
		select {
		case <-called:
		case <-time.After(time.Second):
			t.Fatalf("deletion call %d was not made", call)
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("worker did not stop after cancellation")
	}
}

func TestRunExpireAdminSessionsRetriesAfterError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	succeeded := make(chan struct{}, 1)
	var attempts atomic.Int32
	store := expiredSessionStoreStub{delete: func(context.Context) (int64, error) {
		if attempts.Add(1) == 1 {
			return 0, errors.New("transient database error")
		}
		select {
		case succeeded <- struct{}{}:
		default:
		}
		return 0, nil
	}}
	go func() {
		defer close(done)
		RunExpireAdminSessions(ctx, store, slog.New(slog.NewTextHandler(io.Discard, nil)), time.Millisecond)
	}()

	select {
	case <-succeeded:
	case <-time.After(time.Second):
		t.Fatal("worker did not retry after transient error")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("worker did not stop after cancellation")
	}
}
