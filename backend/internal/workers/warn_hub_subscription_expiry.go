package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// maxSubscriptionExpiryBatches bounds one run the same way
// maxHubSubscriptionBatches does: a backlog above 1,000 candidate rows
// completes over later runs instead of one run growing unbounded.
const maxSubscriptionExpiryBatches = 10
const subscriptionExpiryBatchSize = 100

// subscriptionExpiryLeads is ordered from the tightest window outward. The
// worker picks the first (smallest) lead whose window is open and stops:
// once the shorter window has opened, the longer lead's own moment has
// already passed and must never fire alongside or after it. This is what
// turns a short-notice cancellation (scheduled with under a day left) into
// exactly one 1-day warning instead of also sending a stale 7-day one.
var subscriptionExpiryLeads = []struct {
	lead     sqlc.VetchiumHubSubscriptionNoticeLead
	duration time.Duration
	days     int
}{
	{sqlc.VetchiumHubSubscriptionNoticeLeadOneDay, 24 * time.Hour, 1},
	{sqlc.VetchiumHubSubscriptionNoticeLeadSevenDay, 7 * 24 * time.Hour, 7},
}

type subscriptionExpiryQueries interface {
	ListHubUsersWithEndingSubscriptions(
		context.Context, sqlc.ListHubUsersWithEndingSubscriptionsParams,
	) ([]sqlc.ListHubUsersWithEndingSubscriptionsRow, error)
	RecordHubSubscriptionExpiryNotice(
		context.Context, sqlc.RecordHubSubscriptionExpiryNoticeParams,
	) (bool, error)
}

// subscriptionExpiryPayload is the outbox payload for email.SubscriptionEnding,
// decrypted and decoded by deliverHubEmail.
type subscriptionExpiryPayload struct {
	DisplayName string    `json:"display_name"`
	ExpiresAt   time.Time `json:"expires_at"`
	LeadDays    int       `json:"lead_days"`
}

func (w *Worker) warnHubSubscriptionExpiry(ctx context.Context) error {
	now := time.Now
	if w.hubSubscriptionExpiryNow != nil {
		now = w.hubSubscriptionExpiryNow
	}
	at := now().UTC()

	// Rows are never locked or mutated here, unlike ClaimDueHubSubscriptions,
	// so a row stays a candidate across every batch of this run; the
	// exclusion list is what keeps a later batch from re-selecting one this
	// run already decided.
	skipped := make([]pgtype.UUID, 0)
	for range maxSubscriptionExpiryBatches {
		rows, err := w.subscriptionExpiryQueries.ListHubUsersWithEndingSubscriptions(
			ctx, sqlc.ListHubUsersWithEndingSubscriptionsParams{
				At:                 dbvalue.Timestamp(at),
				SkippedHubUserDids: skipped,
				BatchSize:          subscriptionExpiryBatchSize,
			},
		)
		if err != nil {
			return fmt.Errorf("list ending Hub subscriptions: %w", err)
		}
		for _, row := range rows {
			skipped = append(skipped, row.HubUserDid)
			if err := w.warnOneHubSubscription(ctx, row, at); err != nil {
				return err
			}
		}
		if len(rows) < subscriptionExpiryBatchSize {
			break
		}
	}
	return nil
}

func (w *Worker) warnOneHubSubscription(
	ctx context.Context,
	row sqlc.ListHubUsersWithEndingSubscriptionsRow,
	at time.Time,
) error {
	current := subscriptionspec.Plan(row.HubPlanOid)
	scheduled := subscriptionspec.Plan(row.ScheduledHubPlanOid.String)
	// A scheduled change that holds or raises rank is a renewal (an interval
	// change or a same-plan reselection), not an ending entitlement.
	if subscriptionspec.Rank(scheduled) >= subscriptionspec.Rank(current) {
		return nil
	}

	periodEnd := row.SubscriptionPeriodEnd.Time
	remaining := periodEnd.Sub(at)
	var lead sqlc.VetchiumHubSubscriptionNoticeLead
	var leadDays int
	var due bool
	for _, candidate := range subscriptionExpiryLeads {
		if remaining <= candidate.duration {
			lead, leadDays, due = candidate.lead, candidate.days, true
			break
		}
	}
	if !due {
		return nil
	}

	payload, err := json.Marshal(subscriptionExpiryPayload{
		DisplayName: row.DisplayName,
		ExpiresAt:   periodEnd,
		LeadDays:    leadDays,
	})
	if err != nil {
		return err
	}
	ciphertext, err := credentials.Encrypt(
		w.hubEmailDelivery.OutboxKey, payload,
	)
	if err != nil {
		return err
	}
	if _, err := w.subscriptionExpiryQueries.RecordHubSubscriptionExpiryNotice(
		ctx, sqlc.RecordHubSubscriptionExpiryNoticeParams{
			HubUserDid:            row.HubUserDid,
			PeriodEnd:             row.SubscriptionPeriodEnd,
			LeadTime:              lead,
			RecipientEmailAddress: row.EmailAddress,
			PreferredLanguage:     row.PreferredLanguage,
			PayloadCiphertext:     ciphertext,
			TenantID:              w.tenantID,
			ScheduledHubPlanOid:   row.ScheduledHubPlanOid.String,
		},
	); err != nil {
		return fmt.Errorf("record Hub subscription expiry notice: %w", err)
	}
	return nil
}
