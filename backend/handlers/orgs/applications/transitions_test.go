package applications

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
)

func date(value string) time.Time {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(err)
	}
	return parsed
}

func TestJoinedOnProblem(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 10, 23, 59, 0, 0, time.UTC)
	offer := pgtype.Timestamptz{Time: time.Date(2026, 6, 1, 15, 0, 0, 0, time.UTC), Valid: true}
	locked := sqlc.LockOrgApplicationForWriteRow{OfferExtendedAt: offer}
	for _, test := range []struct {
		name   string
		on     string
		locked sqlc.LockOrgApplicationForWriteRow
		bad    bool
	}{
		{"today", "2026-06-10", locked, false},
		{"tomorrow", "2026-06-11", locked, true},
		{"offer day", "2026-06-01", locked, false},
		{"before offer", "2026-05-31", locked, true},
		{"no offer date", "2020-01-01", sqlc.LockOrgApplicationForWriteRow{}, false},
	} {
		if got := joinedOnProblem(date(test.on), test.locked, now) != nil; got != test.bad {
			t.Errorf("%s: refused = %v, want %v", test.name, got, test.bad)
		}
	}
}

func TestSeparatedOnProblem(t *testing.T) {
	t.Parallel()
	now := time.Date(2027, 12, 31, 0, 0, 0, 0, time.UTC)
	locked := sqlc.LockOrgApplicationForWriteRow{
		JoinedOn: pgtype.Date{Time: date("2026-01-01"), Valid: true},
	}
	for _, test := range []struct {
		on  string
		bad bool
	}{
		{"2026-01-01", true},
		{"2025-12-31", true},
		{"2026-01-02", false},
		{"2027-01-01", false},
		{"2027-01-02", true},
		{"2028-01-01", true},
	} {
		if got := separatedOnProblem(date(test.on), locked, now) != nil; got != test.bad {
			t.Errorf("%s: refused = %v, want %v", test.on, got, test.bad)
		}
	}
}

func TestWindowOpen(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)
	at := func(days int) pgtype.Timestamptz {
		return pgtype.Timestamptz{Time: now.AddDate(0, 0, -days), Valid: true}
	}
	if !windowOpen(at(89), now) || windowOpen(at(91), now) ||
		windowOpen(pgtype.Timestamptz{}, now) {
		t.Fatal("correction window boundary wrong")
	}
}
