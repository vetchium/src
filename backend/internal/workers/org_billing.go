package workers

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/orgs/authorization"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/orgs/billing"
	"backend/internal/orgs/billingdb"
	"backend/internal/orgs/orgmail"
)

// maxOrgBillingRuns bounds one tick's work so a backlog completes over later
// ticks instead of one tick growing unbounded.
const maxOrgBillingRuns = 100

const maxOrgNoticeBatches = 10
const orgNoticeBatchSize = 100

// OrgBillingWork is what the Org billing jobs need beyond the worker's own
// queries.
type OrgBillingWork struct {
	Config  billing.Config
	Charger billing.Charger
	// DueWarningLeads and EndingWarningLeads are the lead times of the
	// unpaid-invoice and plan-ending warnings.
	DueWarningLeads    []time.Duration
	EndingWarningLeads []time.Duration
	// Interval is the cadence of both jobs.
	Interval time.Duration
	// Now is the clock; nil means the wall clock.
	Now func() time.Time
}

func (w OrgBillingWork) now() time.Time {
	if w.Now != nil {
		return w.Now().UTC()
	}
	return time.Now().UTC()
}

// orgBillingQueries is the subset the Org billing jobs need, so their logic is
// testable with a stub instead of a live transaction.
type orgBillingQueries interface {
	billingdb.SaveQueries
	billingdb.EffectQueries
	ClaimDueOrgSubscription(
		context.Context, sqlc.ClaimDueOrgSubscriptionParams,
	) (sqlc.ClaimDueOrgSubscriptionRow, error)
	LockOrgSubscriptionForChange(context.Context, pgtype.UUID) (
		sqlc.LockOrgSubscriptionForChangeRow, error,
	)
}

type orgNoticeQueries interface {
	ListOrgBillingNoticeCandidates(
		context.Context, sqlc.ListOrgBillingNoticeCandidatesParams,
	) ([]sqlc.ListOrgBillingNoticeCandidatesRow, error)
	GetOrgSubscription(context.Context, pgtype.UUID) (
		sqlc.GetOrgSubscriptionRow, error,
	)
	RecordOrgBillingNotice(
		context.Context, sqlc.RecordOrgBillingNoticeParams,
	) (sqlc.RecordOrgBillingNoticeRow, error)
}

// orgBillingTransactions runs one Org's work in its own transaction.
type orgBillingTransactions interface {
	InTransaction(
		ctx context.Context, work func(orgBillingQueries) error,
	) error
}

type poolOrgBillingTransactions struct{ db *pgxpool.Pool }

func (p poolOrgBillingTransactions) InTransaction(
	ctx context.Context, work func(orgBillingQueries) error,
) error {
	tx, err := p.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin Org billing transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := work(sqlc.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// advanceOrgSubscriptions renews, retries, and enforces: every claimed Org is
// brought up to now by billing.Advance in its own transaction, and a deadline
// that passes also disables the users beyond the Free plan.
func (w *Worker) advanceOrgSubscriptions(ctx context.Context) error {
	work := w.orgs.work.Billing
	skipped := make([]pgtype.UUID, 0)
	for range maxOrgBillingRuns {
		processed := false
		err := w.orgBillingTransactions.InTransaction(
			ctx, func(q orgBillingQueries) error {
				at := billing.Instant(work.now())
				claimed, err := q.ClaimDueOrgSubscription(
					ctx, sqlc.ClaimDueOrgSubscriptionParams{
						SkippedOrgDids: skipped,
						At:             dbvalue.Timestamp(at),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return nil
				}
				if err != nil {
					return fmt.Errorf("claim due Org subscription: %w", err)
				}
				processed = true
				skip := func(reason string) {
					skipped = append(skipped, claimed.OrgDid)
					w.log.Error(
						"Org subscription was skipped",
						"event", "org_subscription_skipped",
						"orgDID", dbvalue.FormatUUID(claimed.OrgDid),
						"reason", reason,
					)
				}
				locked, err := q.LockOrgSubscriptionForChange(ctx, claimed.OrgDid)
				if err != nil {
					return fmt.Errorf("lock Org subscription: %w", err)
				}
				state, err := billing.StateFromStored(billingdb.StoredFromRow(
					claimed.OrgDid, sqlc.GetOrgSubscriptionRow(locked),
				))
				if err != nil {
					skip(err.Error())
					return nil
				}
				advanced, transitions := billing.Advance(
					state, at, work.Config, work.Charger,
				)
				if len(transitions) == 0 {
					skip("claimed with nothing due")
					return nil
				}
				if err := billingdb.Save(ctx, q, billingdb.Change{
					OrgDID: claimed.OrgDid, Before: state, Advanced: advanced,
					Final: advanced, System: transitions,
					SystemActor: billing.WorkerRenewalActor,
					TenantID:    w.tenantID, Source: billing.SourceWorkers,
				}); err != nil {
					return fmt.Errorf("save Org subscription: %w", err)
				}
				return w.afterOrgTransitions(ctx, q, claimed, advanced, transitions)
			},
		)
		if err != nil {
			return err
		}
		if !processed {
			return nil
		}
	}
	return nil
}

// afterOrgTransitions does what a transition means for people; the same
// rule runs when a request persists a due transition.
func (w *Worker) afterOrgTransitions(
	ctx context.Context, q orgBillingQueries,
	claimed sqlc.ClaimDueOrgSubscriptionRow, advanced billing.State,
	transitions []billing.Transition,
) error {
	result, err := billingdb.ApplyEffects(ctx, q, billingdb.Effects{
		OrgDID:      claimed.OrgDid,
		Domain:      claimed.Domain,
		Advanced:    advanced,
		Transitions: transitions,
		OutboxKey:   w.orgs.work.Email.OutboxKey,
		TenantID:    w.tenantID,
		Actor:       billing.WorkerRenewalActor,
		Source:      billing.SourceWorkers,
	})
	if err != nil {
		return err
	}
	if result.Enforced {
		w.log.Info(
			"Org dropped to the Free plan for nonpayment",
			"event", "org_deadline_enforced",
			"orgDID", dbvalue.FormatUUID(claimed.OrgDid),
			"disabledUsers", result.DisabledUsers,
		)
	}
	return nil
}

// warnOrgBilling tells billing holders that an invoice's deadline or a plan
// change is near. Each warning is recorded in the same statement that queues
// it, so a repeated or concurrent tick sends it once.
func (w *Worker) warnOrgBilling(ctx context.Context) error {
	work := w.orgs.work.Billing
	at := work.now()
	maxLead := time.Duration(0)
	for _, lead := range append(append([]time.Duration{}, work.DueWarningLeads...), work.EndingWarningLeads...) {
		maxLead = max(maxLead, lead)
	}
	skipped := make([]pgtype.UUID, 0)
	for range maxOrgNoticeBatches {
		rows, err := w.orgNoticeQueries.ListOrgBillingNoticeCandidates(
			ctx, sqlc.ListOrgBillingNoticeCandidatesParams{
				SkippedOrgDids: skipped,
				MaxLeadSeconds: maxLead.Seconds(),
				At:             dbvalue.Timestamp(at),
				BatchSize:      orgNoticeBatchSize,
			},
		)
		if err != nil {
			return fmt.Errorf("list Org billing notice candidates: %w", err)
		}
		for _, row := range rows {
			skipped = append(skipped, row.OrgDid)
			if err := w.warnOneOrg(ctx, row, at); err != nil {
				return err
			}
		}
		if len(rows) < orgNoticeBatchSize {
			return nil
		}
	}
	return nil
}

func (w *Worker) warnOneOrg(
	ctx context.Context, row sqlc.ListOrgBillingNoticeCandidatesRow, at time.Time,
) error {
	work := w.orgs.work.Billing
	subscription, err := w.orgNoticeQueries.GetOrgSubscription(ctx, row.OrgDid)
	if err != nil {
		return fmt.Errorf("get Org subscription: %w", err)
	}
	state, err := billing.StateFromStored(billingdb.StoredFromRow(row.OrgDid, subscription))
	if err != nil {
		w.log.Error(
			"Org subscription was skipped",
			"event", "org_subscription_skipped",
			"orgDID", dbvalue.FormatUUID(row.OrgDid), "reason", err.Error(),
		)
		return nil
	}
	for _, notice := range billing.PendingNotices(
		state, at, work.DueWarningLeads, work.EndingWarningLeads,
	) {
		payload, err := orgmail.Encrypt(w.orgs.work.Email.OutboxKey, orgmail.Payload{
			Domain: row.Domain, ExpiresAt: notice.TargetAt,
		})
		if err != nil {
			return err
		}
		emailKind := "payment-due"
		if notice.Kind == billing.NoticeSubscriptionEnding {
			emailKind = "subscription-ending"
		}
		if _, err := w.orgNoticeQueries.RecordOrgBillingNotice(
			ctx, sqlc.RecordOrgBillingNoticeParams{
				OrgDid:            row.OrgDid,
				NoticeKind:        string(notice.Kind),
				TargetAt:          dbvalue.Timestamp(notice.TargetAt),
				LeadSeconds:       int64(notice.Lead / time.Second),
				EmailKind:         emailKind,
				PayloadCiphertext: payload,
				BillingPermission: string(authorization.ManageBilling),
				TenantID:          w.tenantID,
			},
		); err != nil {
			return fmt.Errorf("record Org billing notice: %w", err)
		}
	}
	return nil
}
