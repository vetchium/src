package workers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	federationspec "github.com/vetchium/src/typespec/federation"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/email"
	"backend/internal/handlerauth"
)

const maxHubApplicationNoticeBatchSize = 100

var applicationNoticeKinds = map[federationspec.ApplicationNotice]email.Kind{
	federationspec.NoticeStatusChanged:      email.ApplicationStatusChanged,
	federationspec.NoticeInterviewScheduled: email.ApplicationInterviewScheduled,
	federationspec.NoticeInterviewChanged:   email.ApplicationInterviewChanged,
	federationspec.NoticeInterviewCancelled: email.ApplicationInterviewCancelled,
	federationspec.NoticeConsentRequested:   email.ApplicationConsentRequested,
	federationspec.NoticeOfferExtended:      email.ApplicationOfferExtended,
	federationspec.NoticeOfferWithdrawn:     email.ApplicationOfferWithdrawn,
	federationspec.NoticeOfferExpiring:      email.ApplicationOfferExpiring,
	federationspec.NoticeOfferExpired:       email.ApplicationOfferExpired,
}

// queueHubApplicationEmails turns the notices that projection events wrote
// (HP-GEN-006) into outbox emails. It is a separate job because only the
// workers hold the outbox key. Each notice commits on its own: the email and
// the notice's removal succeed or fail together.
func (w *Worker) queueHubApplicationEmails(ctx context.Context) error {
	for range maxHubApplicationNoticeBatchSize {
		queued, err := queueHubApplicationEmail(
			ctx, w.applicationDB, w.hubEmailDelivery, w.tenantID)
		if err != nil {
			return fmt.Errorf("queue Hub application email: %w", err)
		}
		if !queued {
			return nil
		}
	}
	return nil
}

// queueHubApplicationEmail reports false once the queue is empty.
func queueHubApplicationEmail(
	ctx context.Context, db *pgxpool.Pool, delivery *HubEmailDelivery,
	tenantID string,
) (bool, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	row, err := q.ClaimHubApplicationNotice(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	kind, ok := applicationNoticeKinds[federationspec.ApplicationNotice(row.Notice)]
	if !ok {
		return false, fmt.Errorf("unknown application notice %q", row.Notice)
	}
	if row.HubUserState != sqlc.VetchiumHubUserStateActive {
		if err := q.AuditDroppedHubApplicationNotice(ctx,
			sqlc.AuditDroppedHubApplicationNoticeParams{
				TenantID: tenantID, HubUserDid: dbvalue.FormatUUID(row.HubUserDid),
			}); err != nil {
			return false, err
		}
		return true, tx.Commit(ctx)
	}
	payload, err := json.Marshal(hubEmailPayload{
		DisplayName: row.DisplayName, OrgName: row.OrgDisplayName,
		OpeningTitle: row.OpeningTitle,
		ApplicationURL: handlerauth.EmailLink(
			delivery.PublicBaseURL, "/applications", tenantID, ""),
	})
	if err != nil {
		return false, err
	}
	ciphertext, err := credentials.Encrypt(delivery.OutboxKey, payload)
	if err != nil {
		return false, err
	}
	queued, err := q.QueueHubApplicationEmail(ctx,
		sqlc.QueueHubApplicationEmailParams{
			Kind: string(kind), RecipientEmailAddress: row.EmailAddress,
			PreferredLanguage: row.PreferredLanguage,
			PayloadCiphertext: ciphertext, TenantID: tenantID,
			HubUserDid: dbvalue.FormatUUID(row.HubUserDid),
		})
	if err != nil {
		return false, err
	}
	if queued != 1 {
		return false, fmt.Errorf("application email was not queued")
	}
	return true, tx.Commit(ctx)
}
