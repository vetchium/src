package billingdb

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/orgs/authorization"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/orgs/billing"
	"backend/internal/orgs/orgmail"
)

// EffectQueries are the writes a persisted transition makes for people.
type EffectQueries interface {
	ListOrgKeepCandidates(
		context.Context, sqlc.ListOrgKeepCandidatesParams,
	) ([]sqlc.ListOrgKeepCandidatesRow, error)
	EnforceOrgDeadline(
		context.Context, sqlc.EnforceOrgDeadlineParams,
	) (sqlc.EnforceOrgDeadlineRow, error)
	QueueOrgBillingHolderEmail(
		context.Context, sqlc.QueueOrgBillingHolderEmailParams,
	) (int64, error)
}

// Effects describes system transitions that were just saved. Advanced is the
// state they produced, before any request's own decision.
type Effects struct {
	OrgDID      pgtype.UUID
	Domain      string
	Advanced    billing.State
	Transitions []billing.Transition
	OutboxKey   [32]byte
	TenantID    string
	Actor       billing.Actor
	Source      string
}

// EffectResult reports what ApplyEffects did, for logs and for a request that
// must re-read seats after users were disabled.
type EffectResult struct {
	Enforced      bool
	DisabledUsers int
}

// ApplyEffects does what saved transitions mean for people, in the caller's
// transaction: at the deadline it disables the users beyond the keep set,
// cancels invitations, and tells them and the kept billing holders; after a
// failed charge it tells the billing holders. It must run after every save of
// system transitions, whether the worker or a request applied them, or a
// deadline a request persisted would leave every user active on Free.
func ApplyEffects(
	ctx context.Context, q EffectQueries, effects Effects,
) (EffectResult, error) {
	failed, enforced := false, false
	for _, transition := range effects.Transitions {
		failed = failed || transition.PaymentFailed()
		enforced = enforced || transition.Kind == billing.KindDeadlineEnforced
	}
	if enforced {
		disabled, err := enforceDeadline(ctx, q, effects)
		return EffectResult{Enforced: true, DisabledUsers: disabled}, err
	}
	if failed && effects.Advanced.Open != nil {
		err := queueHolderEmail(
			ctx, q, effects, "payment-failed", effects.Advanced.Open.DueAt,
		)
		return EffectResult{}, err
	}
	return EffectResult{}, nil
}

func enforceDeadline(
	ctx context.Context, q EffectQueries, effects Effects,
) (int, error) {
	candidates, err := q.ListOrgKeepCandidates(ctx, sqlc.ListOrgKeepCandidatesParams{
		OrgDid:               effects.OrgDID,
		SuperadminPermission: string(authorization.Superadmin),
		BillingPermission:    string(authorization.ManageBilling),
	})
	if err != nil {
		return 0, fmt.Errorf("list Org keep candidates: %w", err)
	}
	keep := make([]billing.KeepCandidate, len(candidates))
	for index, candidate := range candidates {
		keep[index] = billing.KeepCandidate{
			ID:            dbvalue.FormatUUID(candidate.OrgUserID),
			Superadmin:    candidate.Superadmin,
			ManageBilling: candidate.ManageBilling,
			JoinedAt:      candidate.CreatedAt.Time,
		}
	}
	_, disable := billing.KeepSet(keep)
	disableIDs := make([]pgtype.UUID, 0, len(disable))
	for _, id := range disable {
		parsed, err := dbvalue.ParseUUID(id)
		if err != nil {
			return 0, err
		}
		disableIDs = append(disableIDs, parsed)
	}
	payload, err := orgmail.Encrypt(
		effects.OutboxKey, orgmail.Payload{Domain: effects.Domain},
	)
	if err != nil {
		return 0, err
	}
	if _, err := q.EnforceOrgDeadline(ctx, sqlc.EnforceOrgDeadlineParams{
		OrgDid:            effects.OrgDID,
		DisableOrgUserIds: disableIDs,
		PayloadCiphertext: payload,
		TenantID:          effects.TenantID,
		ActorType:         effects.Actor.Type,
		ActorID:           effects.Actor.ID,
		Source:            effects.Source,
	}); err != nil {
		return 0, fmt.Errorf("enforce Org deadline: %w", err)
	}
	// The holders still active are exactly those the keep set retained.
	if err := queueHolderEmail(
		ctx, q, effects, "moved-to-free", time.Time{},
	); err != nil {
		return 0, err
	}
	return len(disableIDs), nil
}

func queueHolderEmail(
	ctx context.Context, q EffectQueries, effects Effects, kind string,
	expiresAt time.Time,
) error {
	payload, err := orgmail.Encrypt(effects.OutboxKey, orgmail.Payload{
		Domain: effects.Domain, ExpiresAt: expiresAt,
	})
	if err != nil {
		return err
	}
	if _, err := q.QueueOrgBillingHolderEmail(ctx, sqlc.QueueOrgBillingHolderEmailParams{
		Kind:              kind,
		PayloadCiphertext: payload,
		OrgDid:            effects.OrgDID,
		BillingPermission: string(authorization.ManageBilling),
	}); err != nil {
		return fmt.Errorf("queue %s email: %w", kind, err)
	}
	return nil
}
