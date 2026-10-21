package workers

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/agencycontacts"
	"backend/internal/db/sqlc"
)

const (
	contactRetentionBatchSize  = 100
	maxContactRetentionBatches = 10
)

// retainOrgContacts removes Contacts and conversations whose retention period passed
// (MKT-CON-004, MKT-CNV-009, MKT-CNV-011) and forgets past daily creation counts (MKT-CON-005, MKT-CNV-003).
func (w *Worker) retainOrgContacts(ctx context.Context) error {
	removed := 0
	for range maxContactRetentionBatches {
		ids, err := w.queries.ListOrgContactsDueForRetention(
			ctx, contactRetentionBatchSize)
		if err != nil {
			return fmt.Errorf("list contacts due for retention: %w", err)
		}
		for _, id := range ids {
			done, err := retainContact(ctx, w.contactRetentionDB, w.tenantID, id)
			if err != nil {
				return fmt.Errorf("retain contact: %w", err)
			}
			if done {
				removed++
			}
		}
		if len(ids) < contactRetentionBatchSize {
			break
		}
	}
	if removed > 0 {
		w.log.Info("contacts removed", "event", "contacts_retained",
			"count", removed)
	}

	// 365-day conversation retention (MKT-CNV-009)
	convsRemoved := 0
	for range maxContactRetentionBatches {
		convs, err := w.queries.ListOrgConversationsDueForRetention(ctx, contactRetentionBatchSize)
		if err != nil {
			return fmt.Errorf("list conversations due for retention: %w", err)
		}
		for _, c := range convs {
			done, err := retainConversation(ctx, w.contactRetentionDB, w.tenantID, c.ConversationID, c.ContactID, "expired")
			if err != nil {
				return fmt.Errorf("retain conversation: %w", err)
			}
			if done {
				convsRemoved++
			}
		}
		if len(convs) < contactRetentionBatchSize {
			break
		}
	}

	// Deleted party conversation retention (MKT-CNV-011)
	if w.deletedPartyConversationRetention > 0 {
		cutoff := time.Now().UTC().Add(-w.deletedPartyConversationRetention)
		for range maxContactRetentionBatches {
			convs, err := w.queries.ListDeletedPartyConversationsDueForRetention(ctx, sqlc.ListDeletedPartyConversationsDueForRetentionParams{
				CutoffPartyDeletedAt: pgtype.Timestamptz{Time: cutoff, Valid: true},
				BatchSize:            contactRetentionBatchSize,
			})
			if err != nil {
				return fmt.Errorf("list deleted party conversations due for retention: %w", err)
			}
			for _, c := range convs {
				done, err := retainConversation(ctx, w.contactRetentionDB, w.tenantID, c.ConversationID, c.ContactID, "party_deleted")
				if err != nil {
					return fmt.Errorf("retain deleted party conversation: %w", err)
				}
				if done {
					convsRemoved++
				}
			}
			if len(convs) < contactRetentionBatchSize {
				break
			}
		}
	}

	if convsRemoved > 0 {
		w.log.Info("conversations removed", "event", "conversations_retained",
			"count", convsRemoved)
	}

	// Prune contact daily creations
	for range maxContactRetentionBatches {
		pruned, err := w.queries.PruneOrgContactCreations(ctx, sqlc.PruneOrgContactCreationsParams{
			BatchSize: contactRetentionBatchSize,
			TenantID:  w.tenantID,
		})
		if err != nil {
			return fmt.Errorf("prune contact creations: %w", err)
		}
		if len(pruned) < contactRetentionBatchSize {
			break
		}
	}

	// Prune conversation daily creations
	for range maxContactRetentionBatches {
		pruned, err := w.queries.PruneOrgConversationCreations(ctx, sqlc.PruneOrgConversationCreationsParams{
			BatchSize: contactRetentionBatchSize,
			TenantID:  w.tenantID,
		})
		if err != nil {
			return fmt.Errorf("prune conversation creations: %w", err)
		}
		if len(pruned) < contactRetentionBatchSize {
			break
		}
	}

	return nil
}

// retainContact deletes one Contact with its notes once its retention period has
// passed, enqueuing its pointer removal to the Hub tenant in the same transaction.
func retainContact(
	ctx context.Context, db *pgxpool.Pool, tenantID string, id pgtype.UUID,
) (bool, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	row, err := q.RetainOrgContact(ctx, sqlc.RetainOrgContactParams{
		ContactID: id, TenantID: tenantID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if row.AuditRows != 1 {
		return false, fmt.Errorf("incomplete contact retention")
	}
	if err := agencycontacts.EnqueuePointer(ctx, q, agencycontacts.Pointer{
		ContactID: row.ContactID, OrgDID: row.OrgDid,
		HubUserDID: row.HubUserDid, Version: row.PointerVersion + 1,
		Present: false,
	}); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

func retainConversation(
	ctx context.Context, db *pgxpool.Pool, tenantID string,
	conversationID, contactID pgtype.UUID, reason string,
) (bool, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := sqlc.New(tx)
	row, err := q.RetainOrgConversation(ctx, sqlc.RetainOrgConversationParams{
		ConversationID: conversationID,
		TenantID:       tenantID,
		Reason:         reason,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	delContact, err := q.DeleteContactIfNoNotes(ctx, sqlc.DeleteContactIfNoNotesParams{
		ContactID: contactID,
		TenantID:  tenantID,
		Source:    "retain-org-contacts",
	})
	if err == nil && delContact.ContactID == contactID {
		if err := agencycontacts.EnqueuePointer(ctx, q, agencycontacts.Pointer{
			ContactID:  delContact.ContactID,
			OrgDID:     delContact.OrgDid,
			HubUserDID: delContact.HubUserDid,
			Version:    delContact.PointerVersion + 1,
			Present:    false,
		}); err != nil {
			return false, err
		}
	} else {
		cTouch, err := q.TouchOrgContactPointer(ctx, sqlc.TouchOrgContactPointerParams{
			ContactID:      contactID,
			LastActivityAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		})
		if err == nil {
			if err := agencycontacts.EnqueuePointer(ctx, q, agencycontacts.Pointer{
				ContactID:       contactID,
				OrgDID:          row.OrgDid,
				HubUserDID:      row.HubUserDid,
				Version:         cTouch.PointerVersion,
				Present:         true,
				HasConversation: false,
			}); err != nil {
				return false, err
			}
		}
	}

	return true, tx.Commit(ctx)
}
