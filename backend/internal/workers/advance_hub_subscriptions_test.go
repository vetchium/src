package workers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/hub/billing"
)

// instrumentedTransactions plays both subscriptionTransactions and
// subscriptionQueries: each test configures canned claim batches and records
// what gets saved, without a combinatorial explosion of stub types.
type instrumentedTransactions struct {
	claimBatches [][]sqlc.ClaimDueHubSubscriptionsRow
	claimErr     error
	saveResult   sqlc.SaveHubSubscriptionStatesRow
	saveErr      error

	claimCalls    int
	savedStates   [][]byte
	savedEvents   [][]byte
	savedSources  []string
	skippedInArgs [][]pgtype.UUID
}

func (it *instrumentedTransactions) InTransaction(
	ctx context.Context, work func(subscriptionQueries) error,
) error {
	return work(it)
}

func (it *instrumentedTransactions) ClaimDueHubSubscriptions(
	_ context.Context, arg sqlc.ClaimDueHubSubscriptionsParams,
) ([]sqlc.ClaimDueHubSubscriptionsRow, error) {
	it.skippedInArgs = append(it.skippedInArgs, arg.SkippedHubUserDids)
	if it.claimErr != nil {
		return nil, it.claimErr
	}
	if it.claimCalls >= len(it.claimBatches) {
		return nil, nil
	}
	batch := it.claimBatches[it.claimCalls]
	it.claimCalls++
	return batch, nil
}

func (it *instrumentedTransactions) SaveHubSubscriptionStates(
	_ context.Context, arg sqlc.SaveHubSubscriptionStatesParams,
) (sqlc.SaveHubSubscriptionStatesRow, error) {
	it.savedStates = append(it.savedStates, arg.States)
	it.savedEvents = append(it.savedEvents, arg.Events)
	it.savedSources = append(it.savedSources, arg.Source)
	return it.saveResult, it.saveErr
}

func claimRow(
	did pgtype.UUID, planOID, interval string,
	anchor, start, end time.Time,
) sqlc.ClaimDueHubSubscriptionsRow {
	return sqlc.ClaimDueHubSubscriptionsRow{
		HubUserDid: did, HubPlanOid: planOID,
		SubscriptionBillingInterval: sqlc.NullVetchiumHubBillingInterval{
			VetchiumHubBillingInterval: sqlc.VetchiumHubBillingInterval(interval),
			Valid:                      interval != "",
		},
		SubscriptionAnchorAt:    pgtype.Timestamptz{Time: anchor, Valid: true},
		SubscriptionPeriodStart: pgtype.Timestamptz{Time: start, Valid: true},
		SubscriptionPeriodEnd:   pgtype.Timestamptz{Time: end, Valid: true},
	}
}

func workerWithTransactions(
	tx subscriptionTransactions, now time.Time,
) (*Worker, *bytes.Buffer) {
	var logs bytes.Buffer
	w := &Worker{
		log:                      slog.New(slog.NewTextHandler(&logs, nil)),
		tenantID:                 "sgp",
		retryBackoffLimit:        time.Second,
		subscriptionTransactions: tx,
		hubSubscriptionNow:       func() time.Time { return now },
	}
	return w, &logs
}

func TestAdvanceHubSubscriptionsSavesOneBatch(t *testing.T) {
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	did := testUUID(1)
	it := &instrumentedTransactions{
		claimBatches: [][]sqlc.ClaimDueHubSubscriptionsRow{
			{claimRow(did, "hub-silver-tier", "month", anchor, anchor, end)},
		},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 1, AuditedCount: 1, AuditedUserCount: 1,
		},
	}
	w, _ := workerWithTransactions(it, end)
	if err := w.advanceHubSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(it.savedStates) != 1 {
		t.Fatalf("save calls = %d, want 1", len(it.savedStates))
	}
	var states []billing.StateRecord
	if err := json.Unmarshal(it.savedStates[0], &states); err != nil {
		t.Fatal(err)
	}
	if len(states) != 1 || states[0].SubscriptionPeriodStart != end.Format(time.RFC3339Nano) {
		t.Fatalf("states = %+v", states)
	}
	var events []billing.EventRecord
	if err := json.Unmarshal(it.savedEvents[0], &events); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Action != billing.ActionRenewed ||
		events[0].ActorType != "worker" {
		t.Fatalf("events = %+v", events)
	}
	if it.savedSources[0] != "workers" {
		t.Fatalf("source = %q", it.savedSources[0])
	}
	if len(it.skippedInArgs) == 0 || it.skippedInArgs[0] == nil {
		t.Fatal("the first claim of a run must receive a non-nil exclusion slice")
	}
}

func TestAdvanceHubSubscriptionsScheduledChangeSavesTwoEvents(t *testing.T) {
	anchor := date(2026, time.January, 1, 0)
	end := date(2027, time.January, 1, 0)
	did := testUUID(1)
	row := claimRow(did, "hub-silver-tier", "year", anchor, anchor, end)
	row.ScheduledHubPlanOid = pgtype.Text{String: "hub-silver-tier", Valid: true}
	row.ScheduledBillingInterval = sqlc.NullVetchiumHubBillingInterval{
		VetchiumHubBillingInterval: sqlc.VetchiumHubBillingIntervalMonth,
		Valid:                      true,
	}
	it := &instrumentedTransactions{
		claimBatches: [][]sqlc.ClaimDueHubSubscriptionsRow{{row}},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 1, AuditedCount: 2, AuditedUserCount: 1,
		},
	}
	at := date(2027, time.April, 15, 0)
	w, _ := workerWithTransactions(it, at)
	if err := w.advanceHubSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	var events []billing.EventRecord
	if err := json.Unmarshal(it.savedEvents[0], &events); err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Action != billing.ActionScheduledChangeApplied ||
		events[1].Action != billing.ActionRenewed {
		t.Fatalf("events = %+v", events)
	}
}

func TestAdvanceHubSubscriptionsMixedBatchTwoUsersThreeEvents(t *testing.T) {
	anchorA := date(2026, time.January, 1, 0)
	endA := date(2027, time.January, 1, 0)
	rowA := claimRow(testUUID(1), "hub-silver-tier", "year", anchorA, anchorA, endA)
	rowA.ScheduledHubPlanOid = pgtype.Text{String: "hub-silver-tier", Valid: true}
	rowA.ScheduledBillingInterval = sqlc.NullVetchiumHubBillingInterval{
		VetchiumHubBillingInterval: sqlc.VetchiumHubBillingIntervalMonth, Valid: true,
	}
	anchorB := date(2027, time.January, 1, 0)
	endB := date(2027, time.February, 1, 0)
	rowB := claimRow(testUUID(2), "hub-silver-tier", "month", anchorB, anchorB, endB)

	at := date(2027, time.April, 15, 0)
	it := &instrumentedTransactions{
		claimBatches: [][]sqlc.ClaimDueHubSubscriptionsRow{{rowA, rowB}},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 2, AuditedCount: 3, AuditedUserCount: 2,
		},
	}
	w, _ := workerWithTransactions(it, at)
	if err := w.advanceHubSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	var states []billing.StateRecord
	if err := json.Unmarshal(it.savedStates[0], &states); err != nil {
		t.Fatal(err)
	}
	if len(states) != 2 {
		t.Fatalf("states = %+v", states)
	}
	var events []billing.EventRecord
	if err := json.Unmarshal(it.savedEvents[0], &events); err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 {
		t.Fatalf("events = %+v, want 3", events)
	}
	didA := dbvalue.FormatUUID(testUUID(1))
	didB := dbvalue.FormatUUID(testUUID(2))
	var eventsA, eventsB []billing.EventRecord
	for _, event := range events {
		switch event.HubUserDID {
		case didA:
			eventsA = append(eventsA, event)
		case didB:
			eventsB = append(eventsB, event)
		default:
			t.Fatalf("event for unexpected user: %+v", event)
		}
	}
	if len(eventsA) != 2 || eventsA[0].Action != billing.ActionScheduledChangeApplied ||
		eventsA[1].Action != billing.ActionRenewed {
		t.Fatalf("user A events = %+v", eventsA)
	}
	if eventsA[1].Payload.Before != eventsA[0].Payload.After {
		t.Fatalf(
			"user A events do not chain: renewed.before=%+v applied.after=%+v",
			eventsA[1].Payload.Before, eventsA[0].Payload.After,
		)
	}
	if len(eventsB) != 1 || eventsB[0].Action != billing.ActionRenewed {
		t.Fatalf("user B events = %+v", eventsB)
	}
}

func TestAdvanceHubSubscriptionsRejectsAuditedUserCountMismatch(t *testing.T) {
	anchorA := date(2026, time.January, 1, 0)
	endA := date(2027, time.January, 1, 0)
	rowA := claimRow(testUUID(1), "hub-silver-tier", "year", anchorA, anchorA, endA)
	rowA.ScheduledHubPlanOid = pgtype.Text{String: "hub-silver-tier", Valid: true}
	rowA.ScheduledBillingInterval = sqlc.NullVetchiumHubBillingInterval{
		VetchiumHubBillingInterval: sqlc.VetchiumHubBillingIntervalMonth, Valid: true,
	}
	anchorB := date(2027, time.January, 1, 0)
	endB := date(2027, time.February, 1, 0)
	rowB := claimRow(testUUID(2), "hub-silver-tier", "month", anchorB, anchorB, endB)
	at := date(2027, time.April, 15, 0)
	it := &instrumentedTransactions{
		claimBatches: [][]sqlc.ClaimDueHubSubscriptionsRow{{rowA, rowB}},
		// Stubbed audited_user_count of 1 despite two distinct users.
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 2, AuditedCount: 3, AuditedUserCount: 1,
		},
	}
	w, _ := workerWithTransactions(it, at)
	if err := w.advanceHubSubscriptions(context.Background()); err == nil {
		t.Fatal("expected an audited_user_count mismatch error")
	}
	if it.claimCalls != 1 {
		t.Fatalf("claim calls = %d, want 1 (no later batch runs)", it.claimCalls)
	}
}

func TestAdvanceHubSubscriptionsRejectsZeroUpdatedCount(t *testing.T) {
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	it := &instrumentedTransactions{
		claimBatches: [][]sqlc.ClaimDueHubSubscriptionsRow{
			{claimRow(testUUID(1), "hub-silver-tier", "month", anchor, anchor, end)},
		},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 0, AuditedCount: 1, AuditedUserCount: 1,
		},
	}
	w, _ := workerWithTransactions(it, end)
	if err := w.advanceHubSubscriptions(context.Background()); err == nil {
		t.Fatal("expected an updated-count mismatch error")
	}
	if it.claimCalls != 1 {
		t.Fatalf("claim calls = %d, want 1 (no later batch runs)", it.claimCalls)
	}
}

func TestAdvanceHubSubscriptionsRejectsShortAuditedCount(t *testing.T) {
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	it := &instrumentedTransactions{
		claimBatches: [][]sqlc.ClaimDueHubSubscriptionsRow{
			{claimRow(testUUID(1), "hub-silver-tier", "month", anchor, anchor, end)},
		},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 1, AuditedCount: 0, AuditedUserCount: 1,
		},
	}
	w, _ := workerWithTransactions(it, end)
	if err := w.advanceHubSubscriptions(context.Background()); err == nil {
		t.Fatal("expected a short audited_count error")
	}
	if it.claimCalls != 1 {
		t.Fatalf("claim calls = %d, want 1 (no later batch runs)", it.claimCalls)
	}
}

func TestAdvanceHubSubscriptionsShortBatchStopsTheRun(t *testing.T) {
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	it := &instrumentedTransactions{
		claimBatches: [][]sqlc.ClaimDueHubSubscriptionsRow{
			{claimRow(testUUID(1), "hub-silver-tier", "month", anchor, anchor, end)},
		},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 1, AuditedCount: 1, AuditedUserCount: 1,
		},
	}
	w, _ := workerWithTransactions(it, end)
	if err := w.advanceHubSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if it.claimCalls != 1 {
		t.Fatalf(
			"claim calls = %d, want 1 (a batch shorter than the limit stops the run)",
			it.claimCalls,
		)
	}
}

func TestAdvanceHubSubscriptionsClaimErrorStopsWithNoLaterBatch(t *testing.T) {
	it := &instrumentedTransactions{claimErr: errors.New("connection reset")}
	w, _ := workerWithTransactions(it, time.Now())
	if err := w.advanceHubSubscriptions(context.Background()); err == nil {
		t.Fatal("expected the claim error to propagate")
	}
	// claimCalls only increments past the error check, so a single failed
	// attempt is proven by the claim's own recorded argument instead.
	if len(it.skippedInArgs) != 1 {
		t.Fatalf("claim attempts = %d, want 1 (no later batch runs)", len(it.skippedInArgs))
	}
}

func TestAdvanceHubSubscriptionsSaveErrorPropagates(t *testing.T) {
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	it := &instrumentedTransactions{
		claimBatches: [][]sqlc.ClaimDueHubSubscriptionsRow{
			{claimRow(testUUID(1), "hub-silver-tier", "month", anchor, anchor, end)},
		},
		saveErr: errors.New("database unavailable"),
	}
	w, _ := workerWithTransactions(it, end)
	if err := w.advanceHubSubscriptions(context.Background()); err == nil {
		t.Fatal("expected the save error to propagate")
	}
	if it.claimCalls != 1 {
		t.Fatalf("claim calls = %d, want 1 (no later batch runs)", it.claimCalls)
	}
}

func TestAdvanceHubSubscriptionsSkipsInvalidRowsAndSavesValidOnes(t *testing.T) {
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	validDID := testUUID(200)
	// A full first batch of invalid rows continues the run, which is what
	// exercises "a later claim in the run excludes the earlier skip": a
	// short batch of mixed rows would otherwise stop the run after one
	// claim regardless of skips.
	invalidBatch := make([]sqlc.ClaimDueHubSubscriptionsRow, hubSubscriptionBatchSize)
	invalidDIDs := make([]pgtype.UUID, hubSubscriptionBatchSize)
	for i := range invalidBatch {
		did := testUUID(byte(i + 1))
		invalidDIDs[i] = did
		invalidBatch[i] = claimRow(did, "hub-gold-tier", "month", anchor, anchor, end)
	}
	validRow := claimRow(validDID, "hub-silver-tier", "month", anchor, anchor, end)
	it := &instrumentedTransactions{
		claimBatches: [][]sqlc.ClaimDueHubSubscriptionsRow{
			invalidBatch,
			{validRow},
		},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 1, AuditedCount: 1, AuditedUserCount: 1,
		},
	}
	w, logs := workerWithTransactions(it, end)
	if err := w.advanceHubSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(it.savedStates) != 1 {
		t.Fatalf("save calls = %d, want 1 (the all-invalid batch saves nothing)", len(it.savedStates))
	}
	var states []billing.StateRecord
	if err := json.Unmarshal(it.savedStates[0], &states); err != nil {
		t.Fatal(err)
	}
	if len(states) != 1 ||
		states[0].HubUserDID != dbvalue.FormatUUID(validDID) {
		t.Fatalf("states = %+v, want only the valid row", states)
	}
	if it.claimCalls != 2 {
		t.Fatalf("claim calls = %d, want 2 (a later claim excludes the skips)", it.claimCalls)
	}
	if len(it.skippedInArgs[0]) != 0 {
		t.Fatalf("the first claim of a run must exclude nothing, got %v", it.skippedInArgs[0])
	}
	if len(it.skippedInArgs[1]) != len(invalidDIDs) {
		t.Fatalf(
			"second claim's exclusion = %d DIDs, want %d",
			len(it.skippedInArgs[1]), len(invalidDIDs),
		)
	}
	if !bytes.Contains(logs.Bytes(), []byte("hub_subscription_skipped")) {
		t.Fatalf("logs = %q, want one aggregate skip error", logs.String())
	}
	if bytes.Count(logs.Bytes(), []byte("hub_subscription_skipped")) != 1 {
		t.Fatalf("logs = %q, want exactly one aggregate skip error", logs.String())
	}
}

func TestAdvanceHubSubscriptionsOneBatchMixesInvalidAndValidRows(t *testing.T) {
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	invalidDID := testUUID(1)
	validDID := testUUID(2)
	invalidRow := claimRow(invalidDID, "hub-gold-tier", "month", anchor, anchor, end)
	validRow := claimRow(validDID, "hub-silver-tier", "month", anchor, anchor, end)
	it := &instrumentedTransactions{
		claimBatches: [][]sqlc.ClaimDueHubSubscriptionsRow{{invalidRow, validRow}},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 1, AuditedCount: 1, AuditedUserCount: 1,
		},
	}
	w, logs := workerWithTransactions(it, end)
	if err := w.advanceHubSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(it.savedStates) != 1 {
		t.Fatalf("save calls = %d, want 1", len(it.savedStates))
	}
	var states []billing.StateRecord
	if err := json.Unmarshal(it.savedStates[0], &states); err != nil {
		t.Fatal(err)
	}
	if len(states) != 1 || states[0].HubUserDID != dbvalue.FormatUUID(validDID) {
		t.Fatalf("states = %+v, want only the valid row", states)
	}
	if !bytes.Contains(logs.Bytes(), []byte("hub_subscription_skipped")) {
		t.Fatalf("logs = %q, want the invalid row logged as skipped", logs.String())
	}
}

func TestAdvanceHubSubscriptionsBatchLimitIsRespected(t *testing.T) {
	anchor := date(2027, time.January, 1, 0)
	end := date(2027, time.February, 1, 0)
	batches := make([][]sqlc.ClaimDueHubSubscriptionsRow, maxHubSubscriptionBatches+2)
	for i := range batches {
		row := claimRow(testUUID(byte(i+1)), "hub-silver-tier", "month", anchor, anchor, end)
		full := make([]sqlc.ClaimDueHubSubscriptionsRow, hubSubscriptionBatchSize)
		for j := range full {
			full[j] = row
			full[j].HubUserDid = testUUID(byte(j + 1))
		}
		batches[i] = full
	}
	it := &instrumentedTransactions{
		claimBatches: batches,
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount:     hubSubscriptionBatchSize,
			AuditedCount:     hubSubscriptionBatchSize,
			AuditedUserCount: hubSubscriptionBatchSize,
		},
	}
	w, _ := workerWithTransactions(it, end)
	if err := w.advanceHubSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if it.claimCalls != maxHubSubscriptionBatches {
		t.Fatalf("claim calls = %d, want %d", it.claimCalls, maxHubSubscriptionBatches)
	}
}

func testUUID(last byte) pgtype.UUID {
	value := [16]byte{6: 0x70, 8: 0x80, 15: last}
	return pgtype.UUID{Bytes: value, Valid: true}
}

func date(year int, month time.Month, day, hour int) time.Time {
	return time.Date(year, month, day, hour, 0, 0, 0, time.UTC)
}
