package workers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"

	"backend/internal/db/sqlc"
	"backend/internal/email"
	"backend/internal/hubapi"
)

const maxHubEmailBatchSize = 100

type hubEmailQueries interface {
	ClaimHubEmail(context.Context, sqlc.ClaimHubEmailParams) (
		sqlc.ClaimHubEmailRow, error,
	)
	MarkHubEmailFailed(context.Context, sqlc.MarkHubEmailFailedParams) (
		bool, error,
	)
	MarkHubEmailSent(context.Context, sqlc.MarkHubEmailSentParams) (
		bool, error,
	)
	ScheduleHubEmailRetry(
		context.Context, sqlc.ScheduleHubEmailRetryParams,
	) (bool, error)
}

type HubEmailDelivery struct {
	TenantID    string
	Renderer    *email.Renderer
	Sender      email.Sender
	OutboxKey   [32]byte
	LeaseTTL    time.Duration
	MaxAttempts int
	Now         func() time.Time
}

type hubEmailPayload struct {
	DisplayName     string    `json:"display_name"`
	VerificationURL string    `json:"verification_url"`
	ResetURL        string    `json:"reset_url"`
	ExpiresAt       time.Time `json:"expires_at"`
}

func (w *Worker) deliverHubEmail(ctx context.Context) error {
	for range maxHubEmailBatchSize {
		delivered, err := w.deliverNextHubEmail(ctx)
		if err != nil {
			return err
		}
		if !delivered {
			return nil
		}
	}
	return nil
}

func (w *Worker) deliverNextHubEmail(ctx context.Context) (bool, error) {
	delivery := w.hubEmailDelivery
	leaseToken, err := hubapi.NewUUID()
	if err != nil {
		return false, err
	}
	now := delivery.currentTime()
	row, err := w.hubEmailQueries.ClaimHubEmail(
		ctx, sqlc.ClaimHubEmailParams{
			LeaseToken:  leaseToken,
			LeasedUntil: hubapi.Timestamp(now.Add(delivery.LeaseTTL)),
			TenantID:    delivery.TenantID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim Hub email: %w", err)
	}

	if err := w.sendClaimedHubEmail(ctx, row); err != nil {
		w.log.Warn(
			"Hub email delivery attempt failed",
			"event", "hub_email_delivery_failed",
			"outboxID", hubapi.FormatUUID(row.HubEmailOutboxID),
			"attempt", row.AttemptCount,
			"error", err,
		)
		if markErr := w.recordHubEmailFailure(
			ctx, row, leaseToken, now,
		); markErr != nil {
			return true, errors.Join(err, markErr)
		}
		return true, nil
	}
	marked, err := w.hubEmailQueries.MarkHubEmailSent(
		ctx, sqlc.MarkHubEmailSentParams{
			HubEmailOutboxID: row.HubEmailOutboxID,
			LeaseToken:       leaseToken,
			TenantID:         delivery.TenantID,
		},
	)
	if err != nil {
		return true, fmt.Errorf("mark Hub email sent: %w", err)
	}
	if !marked {
		return true, fmt.Errorf("hub email lease was lost after delivery")
	}
	return true, nil
}

func (w *Worker) sendClaimedHubEmail(
	ctx context.Context, row sqlc.ClaimHubEmailRow,
) error {
	delivery := w.hubEmailDelivery
	plaintext, err := hubapi.Decrypt(delivery.OutboxKey, row.PayloadCiphertext)
	if err != nil {
		return fmt.Errorf("decrypt email payload: %w", err)
	}
	var payload hubEmailPayload
	if err := json.Unmarshal(plaintext, &payload); err != nil {
		return fmt.Errorf("decode email payload: %w", err)
	}
	kind, actionURL, err := hubEmailKind(row.Kind, payload)
	if err != nil {
		return err
	}
	message, err := delivery.Renderer.Render(
		kind,
		common.FrontendLocale(row.PreferredLanguage),
		email.TemplateData{
			DisplayName: payload.DisplayName,
			ActionURL:   actionURL,
			ExpiresAt:   payload.ExpiresAt,
		},
	)
	if err != nil {
		return err
	}
	message.To = row.RecipientEmailAddress
	message.MessageID = "hub-" + hubapi.FormatUUID(row.HubEmailOutboxID) +
		"@" + delivery.TenantID + ".vetchium"
	return delivery.Sender.Send(ctx, message)
}

func (w *Worker) recordHubEmailFailure(
	ctx context.Context,
	row sqlc.ClaimHubEmailRow,
	leaseToken pgtype.UUID,
	now time.Time,
) error {
	delivery := w.hubEmailDelivery
	if int(row.AttemptCount) >= delivery.MaxAttempts {
		marked, err := w.hubEmailQueries.MarkHubEmailFailed(
			ctx, sqlc.MarkHubEmailFailedParams{
				HubEmailOutboxID: row.HubEmailOutboxID,
				LeaseToken:       leaseToken,
				TenantID:         delivery.TenantID,
			},
		)
		if err != nil {
			return fmt.Errorf("mark Hub email failed: %w", err)
		}
		if !marked {
			return fmt.Errorf("hub email lease was lost after failure")
		}
		return nil
	}
	retryDelay := time.Minute << min(row.AttemptCount-1, 10)
	marked, err := w.hubEmailQueries.ScheduleHubEmailRetry(
		ctx, sqlc.ScheduleHubEmailRetryParams{
			NextAttemptAt:    hubapi.Timestamp(now.Add(retryDelay)),
			HubEmailOutboxID: row.HubEmailOutboxID,
			LeaseToken:       leaseToken,
			TenantID:         delivery.TenantID,
		},
	)
	if err != nil {
		return fmt.Errorf("schedule Hub email retry: %w", err)
	}
	if !marked {
		return fmt.Errorf("hub email lease was lost while scheduling retry")
	}
	return nil
}

func hubEmailKind(
	kind string, payload hubEmailPayload,
) (email.Kind, string, error) {
	switch email.Kind(kind) {
	case email.Signup:
		if payload.VerificationURL == "" {
			return "", "", fmt.Errorf("signup email has no verification URL")
		}
		return email.Signup, payload.VerificationURL, nil
	case email.PasswordReset:
		if payload.ResetURL == "" {
			return "", "", fmt.Errorf("password reset email has no reset URL")
		}
		return email.PasswordReset, payload.ResetURL, nil
	default:
		return "", "", fmt.Errorf("unsupported email kind %q", kind)
	}
}

func (d *HubEmailDelivery) currentTime() time.Time {
	if d.Now != nil {
		return d.Now().UTC()
	}
	return time.Now().UTC()
}
