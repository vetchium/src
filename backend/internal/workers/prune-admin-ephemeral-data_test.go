package workers

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"testing"

	"backend/internal/db/sqlc"
)

type ephemeralStubQuerier struct {
	sqlc.Querier
	calls  []string
	failAt string
}

func (s *ephemeralStubQuerier) result(name string) (int64, error) {
	s.calls = append(s.calls, name)
	if s.failAt == name {
		return 0, errors.New("database unavailable")
	}
	return 1, nil
}

func (s *ephemeralStubQuerier) PruneAdminLoginChallenges(context.Context) (int64, error) {
	return s.result("login challenges")
}

func (s *ephemeralStubQuerier) PruneAdminTOTPEnrollments(context.Context) (int64, error) {
	return s.result("TOTP enrollments")
}

func (s *ephemeralStubQuerier) PruneAdminPasswordResets(context.Context) (int64, error) {
	return s.result("password resets")
}

func (s *ephemeralStubQuerier) PruneAdminInvitations(context.Context) (int64, error) {
	return s.result("invitations")
}

func (s *ephemeralStubQuerier) PruneConsumedAdminTOTPRecoveryCodes(context.Context) (int64, error) {
	return s.result("recovery codes")
}

func (s *ephemeralStubQuerier) PruneAdminEmailOutbox(context.Context) (int64, error) {
	return s.result("outbox")
}

func TestPruneAdminEphemeralDataRunsEveryBoundedDeletion(t *testing.T) {
	var logs bytes.Buffer
	queries := &ephemeralStubQuerier{}
	worker := newTestWorker(slog.New(slog.NewTextHandler(&logs, nil)))
	worker.queries = queries

	if err := worker.pruneAdminEphemeralData(context.Background()); err != nil {
		t.Fatalf("pruneAdminEphemeralData() = %v", err)
	}
	if got, want := len(queries.calls), 6; got != want {
		t.Fatalf("delete calls = %d, want %d: %v", got, want, queries.calls)
	}
	if got := bytes.Count(logs.Bytes(), []byte("count=1")); got != 6 {
		t.Fatalf("count logs = %d, want 6: %q", got, logs.String())
	}
}

func TestPruneAdminEphemeralDataStopsAndWrapsErrors(t *testing.T) {
	queries := &ephemeralStubQuerier{failAt: "TOTP enrollments"}
	worker := newTestWorker(slog.Default())
	worker.queries = queries

	err := worker.pruneAdminEphemeralData(context.Background())
	if err == nil || err.Error() != "prune admin TOTP enrollments: database unavailable" {
		t.Fatalf("pruneAdminEphemeralData() = %v", err)
	}
	if got, want := len(queries.calls), 2; got != want {
		t.Fatalf("delete calls before error = %d, want %d", got, want)
	}
}
