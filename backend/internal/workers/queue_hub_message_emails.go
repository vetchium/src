package workers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
)

const maxHubMessageNoticeBatchSize = 100

// queueHubMessageEmails turns new-message notices (MKT-CNV-008) into outbox emails.
func (w *Worker) queueHubMessageEmails(ctx context.Context) error {
	for range maxHubMessageNoticeBatchSize {
		queued, err := queueHubMessageEmail(
			ctx, w.applicationDB, w.hubEmailDelivery, w.tenantID)
		if err != nil {
			return fmt.Errorf("queue Hub message email: %w", err)
		}
		if !queued {
			return nil
		}
	}
	return nil
}

// queueHubMessageEmail reports false once the queue is empty.
func queueHubMessageEmail(
	ctx context.Context, db *pgxpool.Pool, delivery *HubEmailDelivery,
	tenantID string,
) (bool, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	row, err := q.ClaimHubMessageNotice(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if row.HubUserState != sqlc.VetchiumHubUserStateActive {
		return true, tx.Commit(ctx)
	}
	payload, err := json.Marshal(hubEmailPayload{
		DisplayName: row.DisplayName,
		AgencyName:  row.AgencyDisplayName,
		MessagesURL: handlerauth.EmailLink(
			delivery.PublicBaseURL, "/messages", tenantID, ""),
	})
	if err != nil {
		return false, err
	}
	ciphertext, err := credentials.Encrypt(delivery.OutboxKey, payload)
	if err != nil {
		return false, err
	}
	queued, err := q.QueueHubMessageEmail(ctx,
		sqlc.QueueHubMessageEmailParams{
			RecipientEmailAddress: row.EmailAddress,
			PreferredLanguage:     row.PreferredLanguage,
			PayloadCiphertext:     ciphertext,
			TenantID:              tenantID,
			HubUserDid:            dbvalue.FormatUUID(row.HubUserDid),
		})
	if err != nil {
		return false, err
	}
	if queued != 1 {
		return false, fmt.Errorf("message email was not queued")
	}
	return true, tx.Commit(ctx)
}
