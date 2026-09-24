package workers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/email"
	hubauthn "backend/internal/hub/auth"
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

func TestDeliverExplicitProfessionalCodeEmail(t *testing.T) {
	now := time.Date(2026, 8, 25, 10, 0, 0, 0, time.UTC)
	worker, queries, sender := testEmailWorker(t, now, 1, nil)
	payload, err := json.Marshal(hubEmailPayload{Code: "012345"})
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := credentials.Encrypt(worker.hubEmailDelivery.OutboxKey, payload)
	if err != nil {
		t.Fatal(err)
	}
	queries.claims[0].Kind = string(email.ProfessionalEmailVerification)
	queries.claims[0].PayloadCiphertext = ciphertext

	if err := worker.deliverHubEmail(context.Background()); err != nil {
		t.Fatal(err)
	}
	if queries.sent != 1 || queries.failed != 0 || queries.retry != 0 {
		t.Fatalf("sent=%d failed=%d retry=%d", queries.sent, queries.failed, queries.retry)
	}
	if sender.message.To != "person@example.com" ||
		!strings.Contains(sender.message.TextBody, "012345") ||
		!strings.Contains(sender.message.HTMLBody, "012345") {
		t.Fatalf("professional code email not delivered correctly: %+v", sender.message)
	}
}

func TestCodeEmailsRejectMalformedPayload(t *testing.T) {
	for _, kind := range []email.Kind{
		email.ProfessionalEmailVerification, email.EmailChangeVerification,
	} {
		for _, code := range []string{"", "12345", "1234567", "abcdef", "12 456"} {
			_, _, err := hubEmailKind(string(kind), hubEmailPayload{Code: code})
			if err == nil {
				t.Errorf("%s accepted malformed code %q", kind, code)
			}
		}
	}
}

func TestDeliverEmailChangeMessages(t *testing.T) {
	for _, test := range []struct {
		kind    email.Kind
		payload hubEmailPayload
		want    string
	}{
		{email.EmailChangeVerification, hubEmailPayload{Code: "654321"}, "654321"},
		{email.EmailChanged, hubEmailPayload{}, "was changed"},
	} {
		now := time.Date(2026, 8, 25, 10, 0, 0, 0, time.UTC)
		worker, queries, sender := testEmailWorker(t, now, 1, nil)
		payload, err := json.Marshal(test.payload)
		if err != nil {
			t.Fatal(err)
		}
		ciphertext, err := credentials.Encrypt(
			worker.hubEmailDelivery.OutboxKey, payload,
		)
		if err != nil {
			t.Fatal(err)
		}
		queries.claims[0].Kind = string(test.kind)
		queries.claims[0].PayloadCiphertext = ciphertext

		if err := worker.deliverHubEmail(context.Background()); err != nil {
			t.Fatal(err)
		}
		if queries.sent != 1 || queries.failed != 0 || queries.retry != 0 {
			t.Fatalf("%s sent=%d failed=%d retry=%d", test.kind,
				queries.sent, queries.failed, queries.retry)
		}
		if !strings.Contains(sender.message.TextBody, test.want) ||
			!strings.Contains(sender.message.HTMLBody, test.want) {
			t.Fatalf("%s message = %+v", test.kind, sender.message)
		}
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
	rootKey := hubauthn.DeriveCredentialKey("test", "secret")
	outboxKey := hubauthn.DeriveCredentialSubkey(rootKey, "outbox")
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
