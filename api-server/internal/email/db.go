package email

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// EmailRow is the common shape returned by GetEmailsToSend,
// abstracting over globaldb and regionaldb differences.
type EmailRow struct {
	EmailID       pgtype.UUID
	EmailTo       string
	EmailSubject  string
	EmailTextBody string
	EmailHtmlBody string
	AttemptCount  int64
	LastAttemptAt pgtype.Timestamp
}

// RecordAttemptResult holds the result of recording a delivery attempt.
type RecordAttemptResult struct {
	AttemptID   pgtype.UUID
	AttemptedAt pgtype.Timestamp
}

// EmailDB abstracts the email queue database operations so the worker
// can operate on either globaldb or regionaldb.
type EmailDB interface {
	GetEmailsToSend(ctx context.Context, limit int32) ([]EmailRow, error)
	RecordDeliveryAttempt(ctx context.Context, emailID pgtype.UUID, errorMessage pgtype.Text) (RecordAttemptResult, error)
	MarkEmailAsSent(ctx context.Context, emailID pgtype.UUID) error
	MarkEmailAsFailed(ctx context.Context, emailID pgtype.UUID) error
}

// RegionalEmailDB wraps regionaldb.Queries to implement EmailDB.
type RegionalEmailDB struct {
	Q *regionaldb.Queries
}

func (r *RegionalEmailDB) GetEmailsToSend(ctx context.Context, limit int32) ([]EmailRow, error) {
	rows, err := r.Q.GetEmailsToSend(ctx, limit)
	if err != nil {
		return nil, err
	}
	result := make([]EmailRow, len(rows))
	for i, row := range rows {
		result[i] = EmailRow{
			EmailID:       row.EmailID,
			EmailTo:       row.EmailTo,
			EmailSubject:  row.EmailSubject,
			EmailTextBody: row.EmailTextBody,
			EmailHtmlBody: row.EmailHtmlBody,
			AttemptCount:  int64(row.AttemptCount),
			LastAttemptAt: row.LastAttemptAt,
		}
	}
	return result, nil
}

func (r *RegionalEmailDB) RecordDeliveryAttempt(ctx context.Context, emailID pgtype.UUID, errorMessage pgtype.Text) (RecordAttemptResult, error) {
	row, err := r.Q.RecordDeliveryAttempt(ctx, regionaldb.RecordDeliveryAttemptParams{
		EmailID:      emailID,
		ErrorMessage: errorMessage,
	})
	if err != nil {
		return RecordAttemptResult{}, err
	}
	return RecordAttemptResult{
		AttemptID:   row.AttemptID,
		AttemptedAt: row.AttemptedAt,
	}, nil
}

func (r *RegionalEmailDB) MarkEmailAsSent(ctx context.Context, emailID pgtype.UUID) error {
	return r.Q.MarkEmailAsSent(ctx, emailID)
}

func (r *RegionalEmailDB) MarkEmailAsFailed(ctx context.Context, emailID pgtype.UUID) error {
	return r.Q.MarkEmailAsFailed(ctx, emailID)
}

// GlobalEmailDB wraps globaldb.Queries to implement EmailDB.
type GlobalEmailDB struct {
	Q *globaldb.Queries
}

func (g *GlobalEmailDB) GetEmailsToSend(ctx context.Context, limit int32) ([]EmailRow, error) {
	rows, err := g.Q.GetGlobalEmailsToSend(ctx, limit)
	if err != nil {
		return nil, err
	}
	result := make([]EmailRow, len(rows))
	for i, row := range rows {
		result[i] = EmailRow{
			EmailID:       row.EmailID,
			EmailTo:       row.EmailTo,
			EmailSubject:  row.EmailSubject,
			EmailTextBody: row.EmailTextBody,
			EmailHtmlBody: row.EmailHtmlBody,
			AttemptCount:  int64(row.AttemptCount),
			LastAttemptAt: row.LastAttemptAt,
		}
	}
	return result, nil
}

func (g *GlobalEmailDB) RecordDeliveryAttempt(ctx context.Context, emailID pgtype.UUID, errorMessage pgtype.Text) (RecordAttemptResult, error) {
	row, err := g.Q.RecordGlobalDeliveryAttempt(ctx, globaldb.RecordGlobalDeliveryAttemptParams{
		EmailID:      emailID,
		ErrorMessage: errorMessage,
	})
	if err != nil {
		return RecordAttemptResult{}, err
	}
	return RecordAttemptResult{
		AttemptID:   row.AttemptID,
		AttemptedAt: row.AttemptedAt,
	}, nil
}

func (g *GlobalEmailDB) MarkEmailAsSent(ctx context.Context, emailID pgtype.UUID) error {
	return g.Q.MarkGlobalEmailAsSent(ctx, emailID)
}

func (g *GlobalEmailDB) MarkEmailAsFailed(ctx context.Context, emailID pgtype.UUID) error {
	return g.Q.MarkGlobalEmailAsFailed(ctx, emailID)
}
