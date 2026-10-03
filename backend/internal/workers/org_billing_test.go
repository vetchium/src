package workers

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/orgs/billing"
	"backend/internal/orgs/orgmail"
)

var orgBillingConfig = billing.Config{
	GracePeriod:  14 * 24 * time.Hour,
	RetryOffsets: []time.Duration{72 * time.Hour, 168 * time.Hour, 264 * time.Hour},
}

type fixedOrgCharger struct{ result billing.ChargeResult }

func (c fixedOrgCharger) Charge(subscriptionspec.PaymentMethodKind) billing.ChargeResult {
	return c.result
}

// fakeOrgBilling plays orgBillingTransactions, orgBillingQueries, and
// orgNoticeQueries over one in-memory Org.
type fakeOrgBilling struct {
	orgDID     pgtype.UUID
	domain     string
	row        sqlc.GetOrgSubscriptionRow
	candidates []sqlc.ListOrgKeepCandidatesRow
	noticeRows []sqlc.ListOrgBillingNoticeCandidatesRow

	claimed  bool
	claims   int
	skipped  [][]pgtype.UUID
	saved    []sqlc.SaveOrgSubscriptionParams
	enforced []sqlc.EnforceOrgDeadlineParams
	emails   []sqlc.QueueOrgBillingHolderEmailParams
	notices  []sqlc.RecordOrgBillingNoticeParams
}

func (f *fakeOrgBilling) InTransaction(
	ctx context.Context, work func(orgBillingQueries) error,
) error {
	return work(f)
}

func (f *fakeOrgBilling) ClaimDueOrgSubscription(
	_ context.Context, arg sqlc.ClaimDueOrgSubscriptionParams,
) (sqlc.ClaimDueOrgSubscriptionRow, error) {
	f.claims++
	f.skipped = append(f.skipped, arg.SkippedOrgDids)
	if f.claimed {
		return sqlc.ClaimDueOrgSubscriptionRow{}, pgx.ErrNoRows
	}
	for _, skipped := range arg.SkippedOrgDids {
		if skipped == f.orgDID {
			return sqlc.ClaimDueOrgSubscriptionRow{}, pgx.ErrNoRows
		}
	}
	f.claimed = true
	return sqlc.ClaimDueOrgSubscriptionRow{OrgDid: f.orgDID, Domain: f.domain}, nil
}

func (f *fakeOrgBilling) SaveOrgSubscription(
	_ context.Context, arg sqlc.SaveOrgSubscriptionParams,
) (sqlc.SaveOrgSubscriptionRow, error) {
	f.saved = append(f.saved, arg)
	var changes, events []map[string]any
	_ = json.Unmarshal(arg.InvoiceChanges, &changes)
	_ = json.Unmarshal(arg.Events, &events)
	row := sqlc.SaveOrgSubscriptionRow{UpdatedCount: 1, AuditedCount: int64(len(events))}
	for _, change := range changes {
		switch change["op"] {
		case "create":
			row.CreatedCount++
		case "pay":
			row.PaidCount++
		case "record-failure":
			row.FailedCount++
		case "void":
			row.VoidedCount++
		}
	}
	return row, nil
}

func (f *fakeOrgBilling) ListOrgKeepCandidates(
	context.Context, sqlc.ListOrgKeepCandidatesParams,
) ([]sqlc.ListOrgKeepCandidatesRow, error) {
	return f.candidates, nil
}

func (f *fakeOrgBilling) EnforceOrgDeadline(
	_ context.Context, arg sqlc.EnforceOrgDeadlineParams,
) (sqlc.EnforceOrgDeadlineRow, error) {
	f.enforced = append(f.enforced, arg)
	return sqlc.EnforceOrgDeadlineRow{}, nil
}

func (f *fakeOrgBilling) QueueOrgBillingHolderEmail(
	_ context.Context, arg sqlc.QueueOrgBillingHolderEmailParams,
) (int64, error) {
	f.emails = append(f.emails, arg)
	return 1, nil
}

func (f *fakeOrgBilling) ListOrgBillingNoticeCandidates(
	context.Context, sqlc.ListOrgBillingNoticeCandidatesParams,
) ([]sqlc.ListOrgBillingNoticeCandidatesRow, error) {
	rows := f.noticeRows
	f.noticeRows = nil
	return rows, nil
}

func (f *fakeOrgBilling) GetOrgSubscription(
	context.Context, pgtype.UUID,
) (sqlc.GetOrgSubscriptionRow, error) {
	return f.row, nil
}

func (f *fakeOrgBilling) RecordOrgBillingNotice(
	_ context.Context, arg sqlc.RecordOrgBillingNoticeParams,
) (sqlc.RecordOrgBillingNoticeRow, error) {
	f.notices = append(f.notices, arg)
	return sqlc.RecordOrgBillingNoticeRow{Recorded: true}, nil
}

func monthlyRow(periodEnd time.Time) sqlc.GetOrgSubscriptionRow {
	anchor := periodEnd.AddDate(0, -1, 0)
	return sqlc.GetOrgSubscriptionRow{
		OrgPlanOid: "org-silver-tier",
		OrgBillingInterval: sqlc.NullVetchiumOrgBillingInterval{
			VetchiumOrgBillingInterval: sqlc.VetchiumOrgBillingIntervalMonth, Valid: true,
		},
		SubscriptionAnchorAt:    dbvalue.Timestamp(anchor),
		SubscriptionPeriodStart: dbvalue.Timestamp(anchor),
		SubscriptionPeriodEnd:   dbvalue.Timestamp(periodEnd),
		BillingState:            sqlc.VetchiumOrgBillingStateCurrent,
		OrgState:                sqlc.VetchiumOrgStateActive,
		PaymentMethodKind: sqlc.NullVetchiumOrgPaymentMethodKind{
			VetchiumOrgPaymentMethodKind: sqlc.VetchiumOrgPaymentMethodKindSimulatedDeclines,
			Valid:                        true,
		},
	}
}

func newOrgBillingWorker(
	t *testing.T, fake *fakeOrgBilling, charger billing.Charger, now time.Time,
) (*Worker, *bytes.Buffer) {
	t.Helper()
	var logged bytes.Buffer
	key := [32]byte{7}
	return &Worker{
		log:                    slog.New(slog.NewTextHandler(&logged, nil)),
		tenantID:               "sgp",
		orgBillingTransactions: fake,
		orgNoticeQueries:       fake,
		orgs: &orgJobs{work: OrgWork{
			Email: OrgEmailDelivery{OutboxKey: key},
			Billing: &OrgBillingWork{
				Config:             orgBillingConfig,
				Charger:            charger,
				DueWarningLeads:    []time.Duration{168 * time.Hour, 72 * time.Hour, 24 * time.Hour},
				EndingWarningLeads: []time.Duration{168 * time.Hour, 24 * time.Hour},
				Interval:           time.Second,
				Now:                func() time.Time { return now },
			},
		}},
	}, &logged
}

func newOrgDID(t *testing.T) pgtype.UUID {
	t.Helper()
	did, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	return did
}

func decodeEmailPayload(t *testing.T, w *Worker, ciphertext []byte) orgmail.Payload {
	t.Helper()
	payload, err := orgmail.Decrypt(w.orgs.work.Email.OutboxKey, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestAdvanceOrgSubscriptionsRecordsAFailedRenewalAndWarnsBillingHolders(t *testing.T) {
	t.Parallel()
	end := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	fake := &fakeOrgBilling{
		orgDID: newOrgDID(t), domain: "example.com", row: monthlyRow(end),
	}
	w, _ := newOrgBillingWorker(t, fake, fixedOrgCharger{billing.ChargeDeclined}, end.Add(time.Minute))
	if err := w.advanceOrgSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fake.saved) != 1 || fake.saved[0].Source != billing.SourceWorkers ||
		fake.saved[0].BillingState != sqlc.VetchiumOrgBillingStatePastDue ||
		fake.saved[0].IdempotencyKey.Valid {
		t.Fatalf("saved = %+v", fake.saved)
	}
	var events []map[string]any
	if err := json.Unmarshal(fake.saved[0].Events, &events); err != nil || len(events) != 1 ||
		events[0]["action"] != "org.subscription.renewal-failed" ||
		events[0]["actor_type"] != "worker" {
		t.Fatalf("events = %s, %v", fake.saved[0].Events, err)
	}
	if len(fake.enforced) != 0 {
		t.Fatal("a failed renewal must not enforce the deadline")
	}
	if len(fake.emails) != 1 || fake.emails[0].Kind != "payment-failed" {
		t.Fatalf("emails = %+v", fake.emails)
	}
	payload := decodeEmailPayload(t, w, fake.emails[0].PayloadCiphertext)
	if payload.Domain != "example.com" ||
		!payload.ExpiresAt.Equal(end.Add(14*24*time.Hour)) {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestAdvanceOrgSubscriptionsRenewsWithoutAWarning(t *testing.T) {
	t.Parallel()
	end := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	fake := &fakeOrgBilling{orgDID: newOrgDID(t), domain: "example.com", row: monthlyRow(end)}
	w, _ := newOrgBillingWorker(t, fake, fixedOrgCharger{billing.ChargePaid}, end.Add(time.Minute))
	if err := w.advanceOrgSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fake.saved) != 1 || fake.saved[0].BillingState != sqlc.VetchiumOrgBillingStateCurrent ||
		len(fake.emails) != 0 || len(fake.enforced) != 0 {
		t.Fatalf("saved=%d emails=%d enforced=%d", len(fake.saved), len(fake.emails), len(fake.enforced))
	}
}

func TestAdvanceOrgSubscriptionsEnforcesTheDeadlineWithTheKeepSet(t *testing.T) {
	t.Parallel()
	end := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	row := monthlyRow(end)
	row.BillingState = sqlc.VetchiumOrgBillingStatePastDue
	invoiceID := newOrgDID(t)
	row.OpenInvoiceID = invoiceID
	row.OpenInvoicePlanOid = pgtype.Text{String: "org-silver-tier", Valid: true}
	row.OpenInvoiceBillingInterval = row.OrgBillingInterval
	row.OpenInvoicePeriodStart = row.SubscriptionPeriodStart
	row.OpenInvoicePeriodEnd = row.SubscriptionPeriodEnd
	row.OpenInvoiceReason = sqlc.NullVetchiumOrgInvoiceReason{
		VetchiumOrgInvoiceReason: sqlc.VetchiumOrgInvoiceReasonRenewal, Valid: true,
	}
	due := end.Add(2 * time.Hour)
	row.OpenInvoiceDueAt = dbvalue.Timestamp(due)
	row.OpenInvoiceAttemptCount = pgtype.Int4{Int32: 1, Valid: true}
	row.OpenInvoiceLastFailure = sqlc.NullVetchiumOrgInvoiceFailure{
		VetchiumOrgInvoiceFailure: sqlc.VetchiumOrgInvoiceFailureDeclined, Valid: true,
	}
	row.OpenInvoiceCreatedAt = row.SubscriptionPeriodStart

	candidates := make([]sqlc.ListOrgKeepCandidatesRow, 0, 8)
	ids := make([]pgtype.UUID, 0, 8)
	for index := range 8 {
		id := newOrgDID(t)
		ids = append(ids, id)
		candidates = append(candidates, sqlc.ListOrgKeepCandidatesRow{
			OrgUserID: id, CreatedAt: dbvalue.Timestamp(end.AddDate(0, 0, index)),
			Superadmin: index == 7, ManageBilling: index == 7 || index == 6,
		})
	}
	fake := &fakeOrgBilling{
		orgDID: newOrgDID(t), domain: "example.com", row: row, candidates: candidates,
	}
	w, _ := newOrgBillingWorker(t, fake, fixedOrgCharger{billing.ChargeDeclined}, due.Add(time.Minute))
	if err := w.advanceOrgSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fake.saved) != 1 || fake.saved[0].OrgPlanOid != "org-free-tier" ||
		fake.saved[0].BillingState != sqlc.VetchiumOrgBillingStateCurrent {
		t.Fatalf("saved = %+v", fake.saved)
	}
	if len(fake.enforced) != 1 {
		t.Fatalf("enforced = %d", len(fake.enforced))
	}
	if enforced := fake.enforced[0]; enforced.ActorType != "worker" ||
		enforced.ActorID != "subscription-renewal" || enforced.Source != "workers" {
		t.Fatalf("actor = %s/%s from %s",
			enforced.ActorType, enforced.ActorID, enforced.Source)
	}
	// Keep: the superadmin (7), the billing holder (6), then the three
	// longest-standing (0, 1, 2). Disable 3, 4, 5.
	disabled := map[pgtype.UUID]bool{}
	for _, id := range fake.enforced[0].DisableOrgUserIds {
		disabled[id] = true
	}
	for index, id := range ids {
		want := index >= 3 && index <= 5
		if disabled[id] != want {
			t.Fatalf("user %d disabled = %t, want %t", index, disabled[id], want)
		}
	}
	if len(fake.emails) != 1 || fake.emails[0].Kind != "moved-to-free" {
		t.Fatalf("emails = %+v", fake.emails)
	}
}

func TestAdvanceOrgSubscriptionsSkipsAnUnreadableOrg(t *testing.T) {
	t.Parallel()
	end := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	row := monthlyRow(end)
	row.OrgPlanOid = "org-platinum-tier"
	fake := &fakeOrgBilling{orgDID: newOrgDID(t), domain: "example.com", row: row}
	w, logged := newOrgBillingWorker(t, fake, fixedOrgCharger{billing.ChargePaid}, end.Add(time.Minute))
	if err := w.advanceOrgSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fake.saved) != 0 || fake.claims != 2 {
		t.Fatalf("saved=%d claims=%d", len(fake.saved), fake.claims)
	}
	if len(fake.skipped[1]) != 1 || fake.skipped[1][0] != fake.orgDID {
		t.Fatalf("second claim did not exclude the Org: %+v", fake.skipped)
	}
	if !bytes.Contains(logged.Bytes(), []byte("org_subscription_skipped")) {
		t.Fatalf("log = %s", logged.String())
	}
}

func TestAdvanceOrgSubscriptionsDoesNothingWhenNothingIsDue(t *testing.T) {
	t.Parallel()
	fake := &fakeOrgBilling{orgDID: newOrgDID(t), claimed: true}
	w, _ := newOrgBillingWorker(t, fake, fixedOrgCharger{billing.ChargePaid}, time.Now())
	if err := w.advanceOrgSubscriptions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fake.saved) != 0 || len(fake.emails) != 0 {
		t.Fatal("work happened with nothing due")
	}
}

func TestWarnOrgBillingRecordsOneNoticePerDueLead(t *testing.T) {
	t.Parallel()
	end := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	row := monthlyRow(end)
	row.ScheduledOrgPlanOid = pgtype.Text{String: "org-free-tier", Valid: true}
	fake := &fakeOrgBilling{orgDID: newOrgDID(t), row: row}
	fake.noticeRows = []sqlc.ListOrgBillingNoticeCandidatesRow{
		{OrgDid: fake.orgDID, Domain: "example.com"},
	}
	now := end.Add(-3 * 24 * time.Hour)
	w, _ := newOrgBillingWorker(t, fake, fixedOrgCharger{billing.ChargePaid}, now)
	if err := w.warnOrgBilling(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fake.notices) != 1 {
		t.Fatalf("notices = %+v", fake.notices)
	}
	notice := fake.notices[0]
	if notice.NoticeKind != "subscription-ending" || notice.EmailKind != "subscription-ending" ||
		notice.LeadSeconds != int64((7*24*time.Hour)/time.Second) ||
		!notice.TargetAt.Time.Equal(end) || notice.TenantID != "sgp" {
		t.Fatalf("notice = %+v", notice)
	}
	payload := decodeEmailPayload(t, w, notice.PayloadCiphertext)
	if payload.Domain != "example.com" || !payload.ExpiresAt.Equal(end) {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestWarnOrgBillingWarnsAboutAnOpenInvoice(t *testing.T) {
	t.Parallel()
	end := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	row := monthlyRow(end)
	row.BillingState = sqlc.VetchiumOrgBillingStatePastDue
	row.OpenInvoiceID = newOrgDID(t)
	row.OpenInvoicePlanOid = pgtype.Text{String: "org-silver-tier", Valid: true}
	row.OpenInvoiceBillingInterval = row.OrgBillingInterval
	row.OpenInvoicePeriodStart = row.SubscriptionPeriodStart
	row.OpenInvoicePeriodEnd = row.SubscriptionPeriodEnd
	row.OpenInvoiceReason = sqlc.NullVetchiumOrgInvoiceReason{
		VetchiumOrgInvoiceReason: sqlc.VetchiumOrgInvoiceReasonRenewal, Valid: true,
	}
	due := end.Add(14 * 24 * time.Hour)
	row.OpenInvoiceDueAt = dbvalue.Timestamp(due)
	row.OpenInvoiceAttemptCount = pgtype.Int4{Int32: 1, Valid: true}
	row.OpenInvoiceLastFailure = sqlc.NullVetchiumOrgInvoiceFailure{
		VetchiumOrgInvoiceFailure: sqlc.VetchiumOrgInvoiceFailureDeclined, Valid: true,
	}
	fake := &fakeOrgBilling{orgDID: newOrgDID(t), row: row}
	fake.noticeRows = []sqlc.ListOrgBillingNoticeCandidatesRow{{OrgDid: fake.orgDID, Domain: "example.com"}}
	// Inside the last day only the one-day warning is due.
	w, _ := newOrgBillingWorker(t, fake, fixedOrgCharger{billing.ChargeDeclined}, due.Add(-2*time.Hour))
	if err := w.warnOrgBilling(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fake.notices) != 1 || fake.notices[0].NoticeKind != "payment-due" ||
		fake.notices[0].EmailKind != "payment-due" ||
		fake.notices[0].LeadSeconds != int64((24*time.Hour)/time.Second) {
		t.Fatalf("notices = %+v", fake.notices)
	}
}
