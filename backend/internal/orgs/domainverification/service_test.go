package domainverification

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
	"backend/internal/dnsverify"
)

type fakeQueries struct {
	Queries
	row     sqlc.GetOrgDomainForCheckRow
	calls   []string
	absent  sqlc.RecordOrgDomainAbsentParams
	retryAt time.Time
	// lostBegin makes BeginOrgDomainReclaim lose a race to this row, which
	// later reads return.
	lostBegin *sqlc.GetOrgDomainForCheckRow
	completed pgtype.UUID
}

func (f *fakeQueries) GetOrgDomainForCheck(
	context.Context, pgtype.UUID,
) (sqlc.GetOrgDomainForCheckRow, error) {
	if f.lostBegin != nil && len(f.calls) > 0 {
		return *f.lostBegin, nil
	}
	return f.row, nil
}

func (f *fakeQueries) RecordOrgDomainPresent(
	context.Context, sqlc.RecordOrgDomainPresentParams,
) (bool, error) {
	f.calls = append(f.calls, "present")
	return true, nil
}

func (f *fakeQueries) RecordOrgDomainAbsent(
	_ context.Context, params sqlc.RecordOrgDomainAbsentParams,
) (sqlc.RecordOrgDomainAbsentRow, error) {
	f.calls = append(f.calls, "absent")
	f.absent = params
	return sqlc.RecordOrgDomainAbsentRow{Recorded: true}, nil
}

func (f *fakeQueries) RecordOrgDomainInconclusive(
	_ context.Context, params sqlc.RecordOrgDomainInconclusiveParams,
) (bool, error) {
	f.calls = append(f.calls, "inconclusive")
	f.retryAt = params.NextCheckAt.Time
	return true, nil
}

func (f *fakeQueries) RecordReleasedOrgDomainAbsent(
	context.Context, sqlc.RecordReleasedOrgDomainAbsentParams,
) (bool, error) {
	f.calls = append(f.calls, "released-absent")
	return true, nil
}

func (f *fakeQueries) BeginOrgDomainReclaim(
	context.Context, sqlc.BeginOrgDomainReclaimParams,
) (bool, error) {
	f.calls = append(f.calls, "begin-reclaim")
	return f.lostBegin == nil, nil
}

func (f *fakeQueries) CompleteOrgDomainReclaim(
	_ context.Context, params sqlc.CompleteOrgDomainReclaimParams,
) (bool, error) {
	f.calls = append(f.calls, "complete-reclaim")
	f.completed = params.DirectoryCommandID
	return true, nil
}

func (f *fakeQueries) RejectOrgDomainReclaim(
	context.Context, sqlc.RejectOrgDomainReclaimParams,
) (bool, error) {
	f.calls = append(f.calls, "reject-reclaim")
	return true, nil
}

type fakeChecker struct {
	result dnsverify.Result
	err    error
}

func (f fakeChecker) Check(
	context.Context, string, string,
) (dnsverify.Result, error) {
	return f.result, f.err
}

type fakeDirectory struct {
	claim directoryclient.OrgOutcome
	err   error
}

func (f fakeDirectory) ReleaseOrgDomain(
	context.Context, directoryspec.ReleaseOrgDomainRequest,
) (directoryclient.OrgOutcome, error) {
	return f.claim, f.err
}

func (f fakeDirectory) ClaimOrgDomain(
	context.Context, directoryspec.ClaimOrgDomainRequest,
) (directoryclient.OrgOutcome, error) {
	return f.claim, f.err
}

var (
	testNow    = time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	testPolicy = Policy{
		CheckInterval: 7 * 24 * time.Hour, FailureThreshold: 2,
		FailingGracePeriod: 30 * 24 * time.Hour,
		InconclusiveRetry:  time.Hour, InconclusiveLimit: 7 * 24 * time.Hour,
	}
)

func testService(
	queries *fakeQueries, checker Checker, directory Directory,
) *Service {
	service := New(
		queries, directory, checker, testPolicy, "sgp", [32]byte{1},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	service.now = func() time.Time { return testNow }
	service.jitter = func(time.Duration) time.Duration { return 0 }
	return service
}

func domainRowIn(
	state sqlc.VetchiumOrgDomainState, lastConclusive time.Time, inconclusive int32,
) sqlc.GetOrgDomainForCheckRow {
	return sqlc.GetOrgDomainForCheckRow{
		OrgDid: pgtype.UUID{Valid: true}, Domain: "example.com",
		VerificationToken: "aaaaaaaaaaaaaaaaaaaaaaaaaa", DomainState: state,
		LastConclusiveAt:        dbvalue.Timestamp(lastConclusive),
		ConsecutiveInconclusive: inconclusive,
	}
}

func TestCheckAppliesEachLookupResult(t *testing.T) {
	t.Parallel()
	recent := testNow.Add(-time.Hour)
	for _, test := range []struct {
		name   string
		state  sqlc.VetchiumOrgDomainState
		last   time.Time
		result dnsverify.Result
		want   []string
		report dnsverify.Result
	}{
		{"present restores", sqlc.VetchiumOrgDomainStateFailing, recent,
			dnsverify.Present, []string{"present"}, dnsverify.Present},
		{"absent counts", sqlc.VetchiumOrgDomainStateVerified, recent,
			dnsverify.Absent, []string{"absent"}, dnsverify.Absent},
		{"inconclusive backs off", sqlc.VetchiumOrgDomainStateVerified, recent,
			dnsverify.Inconclusive, []string{"inconclusive"},
			dnsverify.Inconclusive},
		// Permanently broken DNS must not hold a domain forever.
		{"inconclusive past the limit counts as absent",
			sqlc.VetchiumOrgDomainStateVerified,
			testNow.Add(-8 * 24 * time.Hour), dnsverify.Inconclusive,
			[]string{"absent"}, dnsverify.Absent},
		{"absent released domain only reschedules",
			sqlc.VetchiumOrgDomainStateReleased, recent, dnsverify.Absent,
			[]string{"released-absent"}, dnsverify.Absent},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			queries := &fakeQueries{row: domainRowIn(test.state, test.last, 0)}
			result, err := testService(
				queries, fakeChecker{result: test.result}, fakeDirectory{},
			).CheckNow(context.Background(), pgtype.UUID{}, Worker)
			if err != nil || result != test.report {
				t.Fatalf("result = %s, err = %v", result, err)
			}
			if len(queries.calls) != len(test.want) ||
				queries.calls[0] != test.want[0] {
				t.Fatalf("calls = %v, want %v", queries.calls, test.want)
			}
		})
	}
}

func TestAbsentResultCarriesThresholdAndNotice(t *testing.T) {
	t.Parallel()
	queries := &fakeQueries{row: domainRowIn(
		sqlc.VetchiumOrgDomainStateVerified, testNow, 0,
	)}
	if _, err := testService(
		queries, fakeChecker{result: dnsverify.Absent}, fakeDirectory{},
	).CheckNow(context.Background(), pgtype.UUID{}, Worker); err != nil {
		t.Fatal(err)
	}
	if queries.absent.FailureThreshold != 2 ||
		queries.absent.ExpectedState != sqlc.VetchiumOrgDomainStateVerified ||
		len(queries.absent.NoticePayloadCiphertext) == 0 ||
		!queries.absent.NextCheckAt.Time.Equal(testNow.Add(testPolicy.CheckInterval)) {
		t.Fatalf("absent params = %+v", queries.absent)
	}
}

func TestInconclusiveRetryBacksOffToTheInterval(t *testing.T) {
	t.Parallel()
	service := testService(&fakeQueries{}, fakeChecker{}, fakeDirectory{})
	for previous, want := range map[int32]time.Duration{
		0: time.Hour, 1: 2 * time.Hour, 3: 8 * time.Hour,
		20: 128 * time.Hour,
	} {
		if got := service.inconclusiveRetry(previous); got != want {
			t.Errorf("retry after %d = %s, want %s", previous, got, want)
		}
	}
}

func TestReclaimOutcomes(t *testing.T) {
	t.Parallel()
	domain := orgs.OrgDomain("example.com")
	for _, test := range []struct {
		name      string
		directory fakeDirectory
		want      []string
	}{
		{
			"claimed", fakeDirectory{claim: directoryclient.OrgOutcome{
				Status: 200, Org: &directoryspec.OrgPrincipalCommandResponse{
					Domain: &domain,
				},
			}},
			[]string{"begin-reclaim", "complete-reclaim"},
		},
		{
			"owned by another Org", fakeDirectory{
				claim: directoryclient.OrgOutcome{
					Status:  409,
					Problem: &coordinatorproblem.DirectoryClaimConflictError,
				},
			},
			[]string{"begin-reclaim", "reject-reclaim"},
		},
		// An unknown outcome must stay pending so the stored command is sent
		// again, never guessed.
		{
			"directory unreachable",
			fakeDirectory{err: errors.New("connection refused")},
			[]string{"begin-reclaim"},
		},
		{
			"unexpected problem", fakeDirectory{
				claim: directoryclient.OrgOutcome{
					Status:  409,
					Problem: &coordinatorproblem.DirectoryStateConflictError,
				},
			},
			[]string{"begin-reclaim"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			queries := &fakeQueries{row: domainRowIn(
				sqlc.VetchiumOrgDomainStateReleased, testNow, 0,
			)}
			if _, err := testService(
				queries, fakeChecker{result: dnsverify.Present}, test.directory,
			).CheckNow(context.Background(), pgtype.UUID{}, Worker); err != nil {
				t.Fatal(err)
			}
			if len(queries.calls) != len(test.want) {
				t.Fatalf("calls = %v, want %v", queries.calls, test.want)
			}
			for index := range test.want {
				if queries.calls[index] != test.want[index] {
					t.Fatalf("calls = %v, want %v", queries.calls, test.want)
				}
			}
		})
	}
}

// A check that finds the record while another check's re-claim is in flight
// finishes that re-claim with its stored command, rather than reporting the
// Org still suspended.
func TestPresentDuringReclaimFinishesIt(t *testing.T) {
	t.Parallel()
	domain := orgs.OrgDomain("example.com")
	claimed := fakeDirectory{claim: directoryclient.OrgOutcome{
		Status: 200, Org: &directoryspec.OrgPrincipalCommandResponse{
			Domain: &domain,
		},
	}}
	inFlight := domainRowIn(sqlc.VetchiumOrgDomainStateReclaiming, testNow, 0)
	inFlight.DirectoryCommandID = pgtype.UUID{Bytes: [16]byte{7}, Valid: true}
	for _, test := range []struct {
		name    string
		queries *fakeQueries
		want    []string
	}{
		{
			"already reclaiming",
			&fakeQueries{row: inFlight},
			[]string{"complete-reclaim"},
		},
		{
			"lost the race to begin",
			&fakeQueries{
				row: domainRowIn(
					sqlc.VetchiumOrgDomainStateReleased, testNow, 0,
				),
				lostBegin: &inFlight,
			},
			[]string{"begin-reclaim", "complete-reclaim"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if _, err := testService(
				test.queries, fakeChecker{result: dnsverify.Present}, claimed,
			).CheckNow(context.Background(), pgtype.UUID{}, Worker); err != nil {
				t.Fatal(err)
			}
			if fmt.Sprint(test.queries.calls) != fmt.Sprint(test.want) {
				t.Fatalf("calls = %v, want %v", test.queries.calls, test.want)
			}
			if test.queries.completed != inFlight.DirectoryCommandID {
				t.Fatalf("completed command = %v, want the stored one",
					test.queries.completed)
			}
		})
	}
}
