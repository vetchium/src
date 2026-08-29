package workers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/email"
	"backend/internal/hubapi"
)

type hubEmailQueryStub struct {
	claims    []sqlc.ClaimHubEmailRow
	sent      int
	failed    int
	retry     int
	retryTime time.Time
}

func (s *hubEmailQueryStub) ClaimHubEmail(
	context.Context, sqlc.ClaimHubEmailParams,
) (sqlc.ClaimHubEmailRow, error) {
	if len(s.claims) == 0 {
		return sqlc.ClaimHubEmailRow{}, pgx.ErrNoRows
	}
	row := s.claims[0]
	s.claims = s.claims[1:]
	return row, nil
}

func (s *hubEmailQueryStub) MarkHubEmailSent(
	context.Context, sqlc.MarkHubEmailSentParams,
) (bool, error) {
	s.sent++
	return true, nil
}

func (s *hubEmailQueryStub) MarkHubEmailFailed(
	context.Context, sqlc.MarkHubEmailFailedParams,
) (bool, error) {
	s.failed++
	return true, nil
}

func (s *hubEmailQueryStub) ScheduleHubEmailRetry(
	_ context.Context, arg sqlc.ScheduleHubEmailRetryParams,
) (bool, error) {
	s.retry++
	s.retryTime = arg.NextAttemptAt.Time
	return true, nil
}

type emailSenderStub struct {
	message email.Message
	err     error
}

func (s *emailSenderStub) Send(_ context.Context, message email.Message) error {
	s.message = message
	return s.err
}

func TestDeliverHubEmailRendersAndMarksSent(t *testing.T) {
	now := time.Date(2026, 8, 25, 10, 0, 0, 0, time.UTC)
	worker, queries, sender := testEmailWorker(t, now, 1, nil)

	if err := worker.deliverHubEmail(context.Background()); err != nil {
		t.Fatal(err)
	}
	if queries.sent != 1 || queries.retry != 0 || queries.failed != 0 {
		t.Fatalf("sent=%d retry=%d failed=%d", queries.sent, queries.retry, queries.failed)
	}
	if sender.message.To != "person@example.com" ||
		sender.message.Subject == "" || sender.message.TextBody == "" ||
		sender.message.HTMLBody == "" {
		t.Fatalf("message = %+v", sender.message)
	}
}

func TestDeliverHubEmailSchedulesRetryAndEventuallyFails(t *testing.T) {
	now := time.Date(2026, 8, 25, 10, 0, 0, 0, time.UTC)
	worker, queries, _ := testEmailWorker(
		t, now, 2, errors.New("SMTP unavailable"),
	)
	if err := worker.deliverHubEmail(context.Background()); err != nil {
		t.Fatal(err)
	}
	if queries.retry != 1 || queries.retryTime != now.Add(2*time.Minute) {
		t.Fatalf("retry=%d retryTime=%s", queries.retry, queries.retryTime)
	}

	worker, queries, _ = testEmailWorker(
		t, now, 3, errors.New("SMTP unavailable"),
	)
	if err := worker.deliverHubEmail(context.Background()); err != nil {
		t.Fatal(err)
	}
	if queries.failed != 1 || queries.retry != 0 {
		t.Fatalf("retry=%d failed=%d", queries.retry, queries.failed)
	}
}

func testEmailWorker(
	t *testing.T, now time.Time, attempt int32, sendErr error,
) (*Worker, *hubEmailQueryStub, *emailSenderStub) {
	t.Helper()
	rootKey := hubapi.DeriveCredentialKey("test", "secret")
	outboxKey := hubapi.DeriveCredentialSubkey(rootKey, "outbox")
	payload, err := json.Marshal(hubEmailPayload{
		DisplayName: "Person", VerificationURL: "https://hub.test/verify",
		ExpiresAt: now.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := credentials.Encrypt(outboxKey, payload)
	if err != nil {
		t.Fatal(err)
	}
	renderer, err := email.NewRenderer()
	if err != nil {
		t.Fatal(err)
	}
	queries := &hubEmailQueryStub{claims: []sqlc.ClaimHubEmailRow{{
		HubEmailOutboxID: hubTestEmailUUID(), Kind: string(email.Signup),
		RecipientEmailAddress: "person@example.com",
		PreferredLanguage:     "en-US", PayloadCiphertext: ciphertext,
		AttemptCount: attempt,
	}}}
	sender := &emailSenderStub{err: sendErr}
	delivery := &HubEmailDelivery{
		TenantID: "test", Renderer: renderer, Sender: sender,
		OutboxKey: outboxKey, LeaseTTL: time.Minute, MaxAttempts: 3,
		Now: func() time.Time { return now },
	}
	worker := &Worker{
		hubEmailQueries: queries, hubEmailDelivery: delivery,
		log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	return worker, queries, sender
}

func hubTestEmailUUID() pgtype.UUID {
	return pgtype.UUID{Bytes: [16]byte{15: 1}, Valid: true}
}
