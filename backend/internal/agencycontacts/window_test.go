package agencycontacts

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

func TestWindowLetsEachSideWriteUntilTheOtherSidesActivityPlusTheWindow(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)
	day := pgtype.Int8{Int64: 86400, Valid: true}
	window := Window(dbvalue.Timestamp(now.Add(-time.Hour)),
		dbvalue.Timestamp(now.Add(-24*time.Hour)), day)
	if window.AgencyUntil == nil || !window.AgencyUntil.Equal(now.Add(23*time.Hour)) ||
		!window.AgencyMayWrite(now) {
		t.Fatalf("agency until = %v", window.AgencyUntil)
	}
	// The Hub user's instant is exactly now, which is already closed.
	if window.HubUntil == nil || !window.HubUntil.Equal(now) || window.HubMayWrite(now) {
		t.Fatalf("Hub until = %v", window.HubUntil)
	}
	if open := window.Open(now); open.AgencyUntil == nil || open.HubUntil != nil {
		t.Fatalf("open = %+v", open)
	}
}

func TestWindowWithoutActivityOrWindowLetsNoSideWrite(t *testing.T) {
	t.Parallel()
	now := time.Now()
	for name, window := range map[string]WriteWindow{
		"no activity": Window(pgtype.Timestamptz{}, pgtype.Timestamptz{},
			pgtype.Int8{Int64: 86400, Valid: true}),
		"no window": Window(dbvalue.Timestamp(now), dbvalue.Timestamp(now),
			pgtype.Int8{}),
	} {
		if window.AgencyMayWrite(now) || window.HubMayWrite(now) ||
			window.AgencyUntil != nil || window.HubUntil != nil {
			t.Errorf("%s: window = %+v", name, window)
		}
	}
}

func TestBlockedUntilAndWindowDays(t *testing.T) {
	t.Parallel()
	answered := time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)
	ninety := pgtype.Int8{Int64: 90 * 86400, Valid: true}
	request := sqlc.VetchiumOrgChatRequest{
		State:         string(contacts.ChatRequestDeclined),
		DeclineScope:  dbvalue.Text(string(contacts.DeclineSender)),
		AnsweredAt:    dbvalue.Timestamp(answered),
		WindowSeconds: ninety,
	}
	if until := BlockedUntil(request); until == nil ||
		!until.Equal(answered.Add(90*24*time.Hour)) {
		t.Fatalf("blocked until = %v", until)
	}
	request.DeclineScope = dbvalue.Text(string(contacts.DeclineOpening))
	if until := BlockedUntil(request); until != nil {
		t.Fatalf("opening decline blocked until = %v", until)
	}
	if days := WindowDays(ninety); days == nil || *days != 90 {
		t.Fatalf("window days = %v", days)
	}
	if days := WindowDays(pgtype.Int8{}); days != nil {
		t.Fatalf("unknown window days = %v", *days)
	}
}
