// Package applicationchanges writes what every Org change to an application
// owes (agent-guides/hiring-pipeline.md, HP-GEN-007): a history entry and an
// audit event, both without notes or snapshot text, and the Hub projection
// event. Run it in the transaction that changed the applications.
package applicationchanges

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/hubapplications"
)

// Change describes one Org action over the applications it changed.
type Change struct {
	// Action is the history action, also the audit action's suffix.
	Action sqlc.VetchiumOrgApplicationHistoryAction
	// ActorID is the Org user who acted.
	ActorID pgtype.UUID
	// StageID, JoinedOn, and SeparatedOn record what the action concerns.
	StageID     pgtype.UUID
	JoinedOn    pgtype.Date
	SeparatedOn pgtype.Date
	TenantID    string
	// IdempotencyKey correlates the audit events with the request.
	IdempotencyKey string
}

// Record appends the history entries and audit events for applicationIDs and
// enqueues their Hub projection events. Call it after the applications were
// updated; it fails unless every one got its history entry and audit event.
func Record(
	ctx context.Context, q sqlc.Querier, applicationIDs []pgtype.UUID,
	change Change,
) error {
	if len(applicationIDs) == 0 {
		return nil
	}
	row, err := q.RecordOrgApplicationChanges(ctx,
		sqlc.RecordOrgApplicationChangesParams{
			ApplicationIds: applicationIDs, Action: string(change.Action),
			ActorID: change.ActorID, StageID: change.StageID,
			JoinedOn: change.JoinedOn, SeparatedOn: change.SeparatedOn,
			TenantID: change.TenantID, IdempotencyKey: dbvalue.Text(change.IdempotencyKey),
		})
	if err != nil {
		return fmt.Errorf("record application changes: %w", err)
	}
	want := int64(len(applicationIDs))
	if row.SubjectRows != want || row.HistoryRows != want ||
		row.AuditRows != want {
		return fmt.Errorf("incomplete application change record")
	}
	return hubapplications.EnqueueChanges(ctx, q, applicationIDs)
}

// MarkClosedOpeningNotProgressing applies a close request's bulk choice
// (HP-APP-005): every non-terminal application of the Opening the close just
// ended becomes not_progressing, if the request that closed it asked for
// that. It returns how many applications changed.
func MarkClosedOpeningNotProgressing(
	ctx context.Context, q sqlc.Querier, orgDID pgtype.UUID,
	openingNumber int32, change Change,
) (int, error) {
	ids, err := q.MarkClosedOpeningApplicationsNotProgressing(ctx,
		sqlc.MarkClosedOpeningApplicationsNotProgressingParams{
			OrgDid: orgDID, OpeningNumber: openingNumber,
		})
	if err != nil {
		return 0, fmt.Errorf("mark closed Opening applications: %w", err)
	}
	change.Action = sqlc.VetchiumOrgApplicationHistoryActionNotProgressing
	if err := Record(ctx, q, ids, change); err != nil {
		return 0, err
	}
	return len(ids), nil
}
