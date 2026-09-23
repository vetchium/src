package workers

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubauthn "backend/internal/hub/auth"
)

// subscriptionExpiryQueryStub plays subscriptionExpiryQueries. It emulates
// the query's ON CONFLICT DO NOTHING behavior by tracking which
// (hub user, period end, lead) keys it has already recorded, so a test can
// assert idempotent behavior across repeated ticks without a real database.
type subscriptionExpiryQueryStub struct {
	batches       [][]sqlc.ListHubUsersWithEndingSubscriptionsRow
	listCalls     int
	skippedInArgs [][]pgtype.UUID

	recorded map[string]bool
	calls    []sqlc.RecordHubSubscriptionExpiryNoticeParams
	results  []bool
}

func (s *subscriptionExpiryQueryStub) ListHubUsersWithEndingSubscriptions(
	_ context.Context, arg sqlc.ListHubUsersWithEndingSubscriptionsParams,
) ([]sqlc.ListHubUsersWithEndingSubscriptionsRow, error) {
	s.skippedInArgs = append(s.skippedInArgs, arg.SkippedHubUserDids)
	if s.listCalls >= len(s.batches) {
		return nil, nil
	}
	batch := s.batches[s.listCalls]
	s.listCalls++
	return batch, nil
}

func (s *subscriptionExpiryQueryStub) RecordHubSubscriptionExpiryNotice(
	_ context.Context, arg sqlc.RecordHubSubscriptionExpiryNoticeParams,
) (bool, error) {
	s.calls = append(s.calls, arg)
	if s.recorded == nil {
		s.recorded = make(map[string]bool)
	}
	key := dbvalue.FormatUUID(arg.HubUserDid) + "|" +
		arg.PeriodEnd.Time.String() + "|" + string(arg.LeadTime)
	if s.recorded[key] {
		s.results = append(s.results, false)
		return false, nil
	}
	s.recorded[key] = true
	s.results = append(s.results, true)
	return true, nil
}

func endingSubscriptionRow(
	did pgtype.UUID, currentPlan, scheduledPlan string, periodEnd time.Time,
) sqlc.ListHubUsersWithEndingSubscriptionsRow {
	return sqlc.ListHubUsersWithEndingSubscriptionsRow{
		HubUserDid:            did,
		EmailAddress:          "person@example.com",
		DisplayName:           "Person",
		PreferredLanguage:     "en-US",
		HubPlanOid:            currentPlan,
		ScheduledHubPlanOid:   pgtype.Text{String: scheduledPlan, Valid: true},
		SubscriptionPeriodEnd: pgtype.Timestamptz{Time: periodEnd, Valid: true},
	}
}

func warnWorker(
	stub *subscriptionExpiryQueryStub, now time.Time,
) (*Worker, [32]byte, *bytes.Buffer) {
	var logs bytes.Buffer
	rootKey := hubauthn.DeriveCredentialKey("test", "secret")
	outboxKey := hubauthn.DeriveCredentialSubkey(rootKey, "outbox")
	w := &Worker{
		log:                       slog.New(slog.NewTextHandler(&logs, nil)),
		tenantID:                  "sgp",
		subscriptionExpiryQueries: stub,
		hubSubscriptionExpiryNow:  func() time.Time { return now },
		hubEmailDelivery:          &HubEmailDelivery{OutboxKey: outboxKey},
	}
	return w, outboxKey, &logs
}

func TestWarnHubSubscriptionExpirySkipsRenewingPlan(t *testing.T) {
	now := date(2027, time.January, 1, 0)
	did := testUUID(1)
	// Scheduled plan equal to current: an interval change, not an ending
	// entitlement.
	row := endingSubscriptionRow(
		did, "hub-silver-tier", "hub-silver-tier", now.Add(3*24*time.Hour),
	)
	stub := &subscriptionExpiryQueryStub{
		batches: [][]sqlc.ListHubUsersWithEndingSubscriptionsRow{{row}},
	}
	w, _, _ := warnWorker(stub, now)
	if err := w.warnHubSubscriptionExpiry(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(stub.calls) != 0 {
		t.Fatalf("record calls = %d, want 0 for a renewing plan", len(stub.calls))
	}
}

func TestWarnHubSubscriptionExpirySendsSevenDayWarning(t *testing.T) {
	now := date(2027, time.January, 1, 0)
	did := testUUID(1)
	periodEnd := now.Add(7 * 24 * time.Hour)
	row := endingSubscriptionRow(did, "hub-silver-tier", "hub-free-tier", periodEnd)
	stub := &subscriptionExpiryQueryStub{
		batches: [][]sqlc.ListHubUsersWithEndingSubscriptionsRow{{row}},
	}
	w, outboxKey, _ := warnWorker(stub, now)
	if err := w.warnHubSubscriptionExpiry(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(stub.calls) != 1 {
		t.Fatalf("record calls = %d, want 1", len(stub.calls))
	}
	call := stub.calls[0]
	if call.LeadTime != sqlc.VetchiumHubSubscriptionNoticeLeadSevenDay {
		t.Fatalf("lead = %q, want seven_day", call.LeadTime)
	}
	if call.RecipientEmailAddress != "person@example.com" {
		t.Fatalf("recipient = %q, want the account email", call.RecipientEmailAddress)
	}
	payload := decryptSubscriptionExpiryPayload(t, outboxKey, call.PayloadCiphertext)
	if payload.LeadDays != 7 || !payload.ExpiresAt.Equal(periodEnd) {
		t.Fatalf("payload = %+v, want lead 7 and period end %s", payload, periodEnd)
	}
}

func TestWarnHubSubscriptionExpirySendsOneDayWarning(t *testing.T) {
	now := date(2027, time.January, 1, 0)
	did := testUUID(1)
	periodEnd := now.Add(24 * time.Hour)
	row := endingSubscriptionRow(did, "hub-silver-tier", "hub-free-tier", periodEnd)
	stub := &subscriptionExpiryQueryStub{
		batches: [][]sqlc.ListHubUsersWithEndingSubscriptionsRow{{row}},
	}
	w, outboxKey, _ := warnWorker(stub, now)
	if err := w.warnHubSubscriptionExpiry(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(stub.calls) != 1 {
		t.Fatalf("record calls = %d, want 1", len(stub.calls))
	}
	call := stub.calls[0]
	if call.LeadTime != sqlc.VetchiumHubSubscriptionNoticeLeadOneDay {
		t.Fatalf("lead = %q, want one_day", call.LeadTime)
	}
	payload := decryptSubscriptionExpiryPayload(t, outboxKey, call.PayloadCiphertext)
	if payload.LeadDays != 1 {
		t.Fatalf("payload = %+v, want lead 1", payload)
	}
}

func TestWarnHubSubscriptionExpiryDoesNotDuplicateOnSecondTick(t *testing.T) {
	now := date(2027, time.January, 1, 0)
	did := testUUID(1)
	periodEnd := now.Add(7 * 24 * time.Hour)
	row := endingSubscriptionRow(did, "hub-silver-tier", "hub-free-tier", periodEnd)
	stub := &subscriptionExpiryQueryStub{
		batches: [][]sqlc.ListHubUsersWithEndingSubscriptionsRow{{row}, {row}},
	}
	w, _, _ := warnWorker(stub, now)
	if err := w.warnHubSubscriptionExpiry(context.Background()); err != nil {
		t.Fatal(err)
	}
	// A second tick still sees the same candidate (nothing about the row
	// changed), and attempts the same write; the unique constraint the stub
	// emulates is what must keep the outcome to a single effective notice.
	if err := w.warnHubSubscriptionExpiry(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(stub.calls) != 2 {
		t.Fatalf("record attempts = %d, want 2", len(stub.calls))
	}
	inserted := 0
	for _, ok := range stub.results {
		if ok {
			inserted++
		}
	}
	if inserted != 1 {
		t.Fatalf("effective inserts = %d, want exactly 1", inserted)
	}
}

func TestWarnHubSubscriptionExpiryShortNoticeOnlySendsOneDayWarning(t *testing.T) {
	now := date(2027, time.January, 1, 0)
	did := testUUID(1)
	// The change was made with under a day left: the 7-day moment already
	// passed, so only the 1-day warning may ever fire for this period end.
	periodEnd := now.Add(12 * time.Hour)
	row := endingSubscriptionRow(did, "hub-silver-tier", "hub-free-tier", periodEnd)
	stub := &subscriptionExpiryQueryStub{
		batches: [][]sqlc.ListHubUsersWithEndingSubscriptionsRow{{row}, {row}},
	}
	w, _, _ := warnWorker(stub, now)
	if err := w.warnHubSubscriptionExpiry(context.Background()); err != nil {
		t.Fatal(err)
	}
	// A later tick, still inside the 1-day window, must not retroactively
	// attempt the 7-day lead either.
	w.hubSubscriptionExpiryNow = func() time.Time { return now.Add(6 * time.Hour) }
	if err := w.warnHubSubscriptionExpiry(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(stub.calls) != 2 {
		t.Fatalf("record attempts = %d, want 2", len(stub.calls))
	}
	for _, call := range stub.calls {
		if call.LeadTime != sqlc.VetchiumHubSubscriptionNoticeLeadOneDay {
			t.Fatalf("lead = %q, want only one_day ever attempted", call.LeadTime)
		}
	}
}

func decryptSubscriptionExpiryPayload(
	t *testing.T, outboxKey [32]byte, ciphertext []byte,
) subscriptionExpiryPayload {
	t.Helper()
	plaintext, err := credentials.Decrypt(outboxKey, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	var payload subscriptionExpiryPayload
	if err := json.Unmarshal(plaintext, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}
