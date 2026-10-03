package workers

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/appconfig"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/email"
	"backend/internal/orgs/orgmail"
)

const maxOrgEmailBatchSize = 100

type orgEmailQueries interface {
	ClaimOrgEmail(context.Context, sqlc.ClaimOrgEmailParams) (
		sqlc.ClaimOrgEmailRow, error,
	)
	MarkOrgEmailFailed(context.Context, sqlc.MarkOrgEmailFailedParams) (
		bool, error,
	)
	MarkOrgEmailSent(context.Context, sqlc.MarkOrgEmailSentParams) (
		bool, error,
	)
	ScheduleOrgEmailRetry(
		context.Context, sqlc.ScheduleOrgEmailRetryParams,
	) (bool, error)
	PruneOrgEphemeralData(context.Context, string) (int64, error)
}

type OrgSignupRecovery interface {
	Recover(context.Context) (int, error)
}

type OrgDomainVerification interface {
	CheckDue(context.Context) error
	ReleaseExpired(context.Context) error
}

type OrgEmailDelivery struct {
	Renderer    *email.Renderer
	Sender      email.Sender
	OutboxKey   [32]byte
	LeaseTTL    time.Duration
	MaxAttempts int
	Now         func() time.Time
}

// OrgWork is everything the Org jobs need beyond the worker's own queries.
type OrgWork struct {
	Email   OrgEmailDelivery
	Signup  OrgSignupRecovery
	Domains OrgDomainVerification
}

type orgJobs struct {
	queries  orgEmailQueries
	work     OrgWork
	tenantID string
}

func (w *Worker) EnableOrgs(config appconfig.Workers, work OrgWork) {
	jobs := &orgJobs{queries: w.orgQueries, work: work, tenantID: w.tenantID}
	w.orgs = jobs
	w.jobs = append(w.jobs,
		periodicJob{
			name: "deliver-org-email", interval: config.DeliverOrgEmailTimer,
			run: w.deliverOrgEmail,
		},
		periodicJob{
			name:     "reconcile-org-signup",
			interval: config.ReconcileOrgSignupTimer,
			run: func(ctx context.Context) error {
				_, err := work.Signup.Recover(ctx)
				return err
			},
		},
		periodicJob{
			name:     "verify-org-domains",
			interval: config.VerifyOrgDomainsTimer,
			run: func(ctx context.Context) error {
				if err := work.Domains.CheckDue(ctx); err != nil {
					return err
				}
				return work.Domains.ReleaseExpired(ctx)
			},
		},
		periodicJob{
			name:     "prune-org-ephemeral-data",
			interval: config.PruneEphemeralDataTimer,
			run:      w.pruneOrgEphemeralData,
		},
	)
}

func (w *Worker) pruneOrgEphemeralData(ctx context.Context) error {
	deleted, err := w.orgs.queries.PruneOrgEphemeralData(ctx, w.tenantID)
	if err != nil {
		return fmt.Errorf("prune Org ephemeral data: %w", err)
	}
	if deleted > 0 {
		w.log.Info("Org ephemeral data pruned", "count", deleted)
	}
	return nil
}

func (w *Worker) deliverOrgEmail(ctx context.Context) error {
	for range maxOrgEmailBatchSize {
		delivered, err := w.deliverNextOrgEmail(ctx)
		if err != nil || !delivered {
			return err
		}
	}
	return nil
}

func (w *Worker) deliverNextOrgEmail(ctx context.Context) (bool, error) {
	delivery := w.orgs.work.Email
	leaseToken, err := dbvalue.NewUUID()
	if err != nil {
		return false, err
	}
	now := delivery.currentTime()
	row, err := w.orgs.queries.ClaimOrgEmail(ctx, sqlc.ClaimOrgEmailParams{
		LeaseToken:  leaseToken,
		LeasedUntil: dbvalue.Timestamp(now.Add(delivery.LeaseTTL)),
		TenantID:    w.tenantID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim Org email: %w", err)
	}
	if err := w.sendClaimedOrgEmail(ctx, row); err != nil {
		w.log.Warn(
			"Org email delivery attempt failed",
			"event", "org_email_delivery_failed",
			"outboxID", dbvalue.FormatUUID(row.OrgEmailOutboxID),
			"attempt", row.AttemptCount,
			"error", err,
		)
		if markErr := w.recordOrgEmailFailure(
			ctx, row, leaseToken, now,
		); markErr != nil {
			return true, errors.Join(err, markErr)
		}
		return true, nil
	}
	marked, err := w.orgs.queries.MarkOrgEmailSent(
		ctx, sqlc.MarkOrgEmailSentParams{
			OrgEmailOutboxID: row.OrgEmailOutboxID,
			LeaseToken:       leaseToken,
			TenantID:         w.tenantID,
		},
	)
	if err != nil {
		return true, fmt.Errorf("mark Org email sent: %w", err)
	}
	if !marked {
		return true, fmt.Errorf("org email lease was lost after delivery")
	}
	return true, nil
}

func (w *Worker) sendClaimedOrgEmail(
	ctx context.Context, row sqlc.ClaimOrgEmailRow,
) error {
	delivery := w.orgs.work.Email
	payload, err := orgmail.Decrypt(delivery.OutboxKey, row.PayloadCiphertext)
	if err != nil {
		return err
	}
	kind, err := orgEmailKind(row.Kind, payload)
	if err != nil {
		return err
	}
	message, err := delivery.Renderer.Render(
		kind, row.PreferredLanguage, email.TemplateData{
			ActionURL:    payload.ActionURL,
			ExpiresAt:    payload.ExpiresAt,
			Domain:       payload.Domain,
			RecordName:   payload.RecordName,
			RecordValue:  payload.RecordValue,
			ReleaseAfter: payload.ReleaseAfter,
		},
	)
	if err != nil {
		return err
	}
	message.To = row.RecipientEmailAddress
	message.MessageID = "org-" + dbvalue.FormatUUID(row.OrgEmailOutboxID) +
		"@" + w.tenantID + ".vetchium"
	return delivery.Sender.Send(ctx, message)
}

func (w *Worker) recordOrgEmailFailure(
	ctx context.Context, row sqlc.ClaimOrgEmailRow, leaseToken pgtype.UUID,
	now time.Time,
) error {
	delivery := w.orgs.work.Email
	if int(row.AttemptCount) >= delivery.MaxAttempts {
		marked, err := w.orgs.queries.MarkOrgEmailFailed(
			ctx, sqlc.MarkOrgEmailFailedParams{
				OrgEmailOutboxID: row.OrgEmailOutboxID,
				LeaseToken:       leaseToken,
				TenantID:         w.tenantID,
			},
		)
		if err != nil {
			return fmt.Errorf("mark Org email failed: %w", err)
		}
		if !marked {
			return fmt.Errorf("org email lease was lost after failure")
		}
		return nil
	}
	retryDelay := time.Minute << min(row.AttemptCount-1, 10)
	marked, err := w.orgs.queries.ScheduleOrgEmailRetry(
		ctx, sqlc.ScheduleOrgEmailRetryParams{
			NextAttemptAt:    dbvalue.Timestamp(now.Add(retryDelay)),
			OrgEmailOutboxID: row.OrgEmailOutboxID,
			LeaseToken:       leaseToken,
			TenantID:         w.tenantID,
		},
	)
	if err != nil {
		return fmt.Errorf("schedule Org email retry: %w", err)
	}
	if !marked {
		return fmt.Errorf("org email lease was lost while scheduling retry")
	}
	return nil
}

// orgEmailKind maps an outbox kind to its template and rejects a payload
// missing what that message needs, so a broken message is never sent.
func orgEmailKind(kind string, payload orgmail.Payload) (email.Kind, error) {
	if payload.Domain == "" {
		return "", fmt.Errorf("org email %q has no domain", kind)
	}
	hasRecord := payload.RecordName != "" && payload.RecordValue != ""
	switch kind {
	case "signup-dns-instructions":
		if !hasRecord || payload.ExpiresAt.IsZero() {
			return "", fmt.Errorf("DNS instructions email is incomplete")
		}
		return email.OrgSignupDNSInstructions, nil
	case "signup-link":
		if payload.ActionURL == "" || payload.ExpiresAt.IsZero() {
			return "", fmt.Errorf("signup link email is incomplete")
		}
		return email.OrgSignupLink, nil
	case "password-reset":
		if payload.ActionURL == "" || payload.ExpiresAt.IsZero() {
			return "", fmt.Errorf("password reset email is incomplete")
		}
		return email.OrgPasswordReset, nil
	case "domain-failing":
		if !hasRecord || payload.ReleaseAfter.IsZero() {
			return "", fmt.Errorf("domain failing email is incomplete")
		}
		return email.OrgDomainFailing, nil
	case "invitation":
		if payload.ActionURL == "" || payload.ExpiresAt.IsZero() {
			return "", fmt.Errorf("invitation email is incomplete")
		}
		return email.OrgInvitation, nil
	case "org-suspended":
		if !hasRecord {
			return "", fmt.Errorf("suspension email is incomplete")
		}
		return email.OrgSuspended, nil
	default:
		return "", fmt.Errorf("unsupported Org email kind %q", kind)
	}
}

func (d OrgEmailDelivery) currentTime() time.Time {
	if d.Now != nil {
		return d.Now().UTC()
	}
	return time.Now().UTC()
}
