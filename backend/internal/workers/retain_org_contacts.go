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

	// Conversations go 365 days after their last message (MKT-CNV-009), and
	// one whose other party was deleted once the configured retention passed
	// (MKT-CNV-011).
	cutoff := time.Now().UTC().Add(-w.deletedPartyConversationRetention)
	convsRemoved := 0
	for _, list := range []func() ([]pgtype.UUID, error){
		func() ([]pgtype.UUID, error) {
			rows, err := w.queries.ListOrgConversationsDueForRetention(ctx, contactRetentionBatchSize)
			ids := make([]pgtype.UUID, len(rows))
			for index, row := range rows {
				ids[index] = row.ConversationID
			}
			return ids, err
		},
		func() ([]pgtype.UUID, error) {
			rows, err := w.queries.ListDeletedPartyConversationsDueForRetention(ctx,
				sqlc.ListDeletedPartyConversationsDueForRetentionParams{
					CutoffPartyDeletedAt: pgtype.Timestamptz{Time: cutoff, Valid: true},
					BatchSize:            contactRetentionBatchSize,
				})
			ids := make([]pgtype.UUID, len(rows))
			for index, row := range rows {
				ids[index] = row.ConversationID
			}
			return ids, err
		},
	} {
		for range maxContactRetentionBatches {
			ids, err := list()
			if err != nil {
				return fmt.Errorf("list conversations due for retention: %w", err)
			}
			for _, id := range ids {
				done, err := retainConversation(ctx, w.contactRetentionDB, w.tenantID, id, cutoff)
				if err != nil {
					return fmt.Errorf("retain conversation: %w", err)
				}
				if done {
					convsRemoved++
				}
			}
			if len(ids) < contactRetentionBatchSize {
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

// retainContact deletes one Contact with its notes once its retention period
// has passed, enqueuing its pointer removal to the Hub tenant in the same
// transaction.
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
	if err := agencycontacts.RemovePointer(ctx, q, row.OrgDid, row.ContactID,
		row.HubUserDid, row.PointerVersion); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

// retainConversation deletes one conversation whose retention passed. Its
// Contact stays while it has notes, and goes with the conversation otherwise
// (MKT-CON-004). Neither counts as the Contact's activity.
func retainConversation(
	ctx context.Context, db *pgxpool.Pool, tenantID string,
	conversationID pgtype.UUID, cutoff time.Time,
) (bool, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	row, err := q.RetainOrgConversation(ctx, sqlc.RetainOrgConversationParams{
		ConversationID:       conversationID,
		CutoffPartyDeletedAt: pgtype.Timestamptz{Time: cutoff, Valid: true},
		TenantID:             tenantID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if row.AuditRows != 1 {
		return false, fmt.Errorf("incomplete conversation retention")
	}
	gone, err := q.DeleteUnusedOrgContact(ctx, sqlc.DeleteUnusedOrgContactParams{
		ContactID: row.ContactID, OrgDid: row.OrgDid, TenantID: tenantID,
		ActorType: "worker", ActorID: "retain-org-contacts", Source: "workers",
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		err = agencycontacts.SyncPointer(ctx, q, row.OrgDid, row.ContactID, false)
	case err != nil:
		return false, err
	default:
		err = agencycontacts.RemovePointer(ctx, q, row.OrgDid, row.ContactID,
			row.HubUserDid, gone.PointerVersion)
	}
	if err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
