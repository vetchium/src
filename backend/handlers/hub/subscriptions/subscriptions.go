package subscriptions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/hub/billing"
	"backend/internal/middleware"
)

func MySubscription(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		row, err := s.Queries.GetHubMySubscription(
			r.Context(), sqlc.GetHubMySubscriptionParams{
				HubSessionID: identity.SessionID,
				HubUserDid:   identity.UserDID,
			},
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.AuthenticationProblem(
					r.Context(), w,
					hubproblem.AuthenticationRequiredError,
					hubauthn.BearerChallenge,
				)
				return
			}
			s.InternalError(r.Context(), w, "get Hub subscription", err)
			return
		}
		stored := storedFromMySubscription(row)
		stored.HubUserDID = dbvalue.FormatUUID(identity.UserDID)
		state, err := billing.StateFromStored(stored)
		if err != nil {
			s.InternalError(r.Context(), w, "decode Hub subscription state", err)
			return
		}
		// GET computes any due period-end transition in memory and writes
		// nothing, so a lagging worker never shows an ended period.
		advanced, _ := billing.Advance(state, billing.Instant(s.CurrentTime()))
		s.JSON(r.Context(), w, http.StatusOK, responseFromState(advanced))
	}
}

// setPlanQueries is the subset SetSubscriptionPlan needs, so its decision
// logic is testable with a stub instead of a live transaction.
type setPlanQueries interface {
	LockHubSubscriptionForChange(context.Context, pgtype.UUID) (
		sqlc.LockHubSubscriptionForChangeRow, error,
	)
	SaveHubSubscriptionStates(
		context.Context, sqlc.SaveHubSubscriptionStatesParams,
	) (sqlc.SaveHubSubscriptionStatesRow, error)
}

type setPlanEnv struct {
	TenantID string
	Offers   func(subscriptionspec.Plan) bool
	Now      func() time.Time
}

func SetSubscriptionPlan(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request subscriptionspec.SetSubscriptionPlanRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		env := setPlanEnv{
			TenantID: s.TenantID, Offers: s.Offers, Now: s.CurrentTime,
		}
		handlerauth.RunIdempotent(
			s, w, r, "hub:set-subscription-plan",
			dbvalue.FormatUUID(identity.UserDID), key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[subscriptionspec.HubSubscription],
				*handlerauth.Problem, error,
			) {
				return setPlan(
					r.Context(), env, q, identity.UserDID, request, key,
				)
			},
		)
	}
}

func setPlan(
	ctx context.Context, env setPlanEnv, q setPlanQueries,
	did pgtype.UUID, request subscriptionspec.SetSubscriptionPlanRequest,
	key common.IdempotencyKey,
) (
	handlerauth.Result[subscriptionspec.HubSubscription],
	*handlerauth.Problem, error,
) {
	zero := handlerauth.Result[subscriptionspec.HubSubscription]{}

	// The target must always be offered, even when re-choosing a current
	// plan the tenant has since withdrawn: withdrawal behavior is an open
	// question, and refusing is the conservative reading of the design's
	// "refuses a change to a plan the tenant does not offer".
	if !env.Offers(request.PlanOID) {
		return handlerauth.Failure[subscriptionspec.HubSubscription](
			hubproblem.PlanNotOfferedError,
		)
	}

	row, err := q.LockHubSubscriptionForChange(ctx, did)
	if errors.Is(err, pgx.ErrNoRows) {
		return handlerauth.AuthenticationFailure[subscriptionspec.HubSubscription](
			hubproblem.AuthenticationRequiredError, hubauthn.BearerChallenge,
		)
	}
	if err != nil {
		return zero, nil, err
	}

	hubUserDID := dbvalue.FormatUUID(did)
	stored := storedFromLock(row)
	stored.HubUserDID = hubUserDID
	state, err := billing.StateFromStored(stored)
	if err != nil {
		return zero, nil, err
	}

	// `at` is read after the row lock is held, and the row stays locked
	// through the save below, so one period-end transition cannot be applied
	// twice by a racing request.
	at := billing.Instant(env.Now())
	advanced, transitions := billing.Advance(state, at)
	decided, decision, outcome := billing.Decide(
		advanced, request.PlanOID, request.BillingInterval.Value, at,
	)

	if len(transitions) == 0 && outcome == billing.Unchanged {
		return handlerauth.Result[subscriptionspec.HubSubscription]{
			Status: http.StatusOK, Body: responseFromState(advanced),
		}, nil, nil
	}

	events := billing.SystemTransitionEvents(
		hubUserDID, state, transitions, billing.SystemRenewalActor,
	)
	if decisionEvent := billing.DecisionEvent(
		hubUserDID, advanced, decision, billing.HubUserActor(hubUserDID),
	); decisionEvent != nil {
		events = append(events, *decisionEvent)
	}

	statesJSON, err := json.Marshal(
		[]billing.StateRecord{billing.NewStateRecord(hubUserDID, decided)},
	)
	if err != nil {
		return zero, nil, err
	}
	eventsJSON, err := json.Marshal(events)
	if err != nil {
		return zero, nil, err
	}

	saved, err := q.SaveHubSubscriptionStates(
		ctx, sqlc.SaveHubSubscriptionStatesParams{
			States:         statesJSON,
			Events:         eventsJSON,
			TenantID:       env.TenantID,
			Source:         billing.SourceHubAPI,
			IdempotencyKey: dbvalue.Text(string(key)),
		},
	)
	if err != nil {
		return zero, nil, err
	}
	if saved.UpdatedCount != 1 || saved.AuditedCount != int64(len(events)) ||
		saved.AuditedUserCount != saved.UpdatedCount {
		return zero, nil, fmt.Errorf(
			"save Hub subscription states: updated=%d audited=%d "+
				"audited_users=%d, want updated=1 audited=%d audited_users=1",
			saved.UpdatedCount, saved.AuditedCount, saved.AuditedUserCount,
			len(events),
		)
	}

	return handlerauth.Result[subscriptionspec.HubSubscription]{
		Status: http.StatusOK, Body: responseFromState(decided),
	}, nil, nil
}

func responseFromState(state billing.State) subscriptionspec.HubSubscription {
	response := subscriptionspec.HubSubscription{
		PlanOID: subscriptionspec.PlanOID(state.Plan),
		CancelAtPeriodEnd: state.ScheduledPlan ==
			subscriptionspec.FreeTier,
	}
	if state.Plan != subscriptionspec.FreeTier {
		interval := state.Interval
		start := state.PeriodStart
		end := state.PeriodEnd
		response.BillingInterval = &interval
		response.CurrentPeriodStart = &start
		response.CurrentPeriodEnd = &end
	}
	if state.HasSchedule() {
		change := subscriptionspec.ScheduledPlanChange{
			PlanOID: subscriptionspec.PlanOID(state.ScheduledPlan),
		}
		if state.ScheduledPlan != subscriptionspec.FreeTier {
			interval := state.ScheduledInterval
			change.BillingInterval = &interval
		}
		response.ScheduledChange = &change
	}
	return response
}

func storedFromMySubscription(row sqlc.GetHubMySubscriptionRow) billing.Stored {
	return billing.Stored{
		PlanOID: row.HubPlanOid,
		Interval: hubruntime.BillingIntervalFromNull(
			row.SubscriptionBillingInterval,
		),
		AnchorAt:         dbvalue.TimePtr(row.SubscriptionAnchorAt),
		PeriodStart:      dbvalue.TimePtr(row.SubscriptionPeriodStart),
		PeriodEnd:        dbvalue.TimePtr(row.SubscriptionPeriodEnd),
		ScheduledPlanOID: row.ScheduledHubPlanOid.String,
		ScheduledInterval: hubruntime.BillingIntervalFromNull(
			row.ScheduledBillingInterval,
		),
	}
}

func storedFromLock(row sqlc.LockHubSubscriptionForChangeRow) billing.Stored {
	return billing.Stored{
		PlanOID: row.HubPlanOid,
		Interval: hubruntime.BillingIntervalFromNull(
			row.SubscriptionBillingInterval,
		),
		AnchorAt:         dbvalue.TimePtr(row.SubscriptionAnchorAt),
		PeriodStart:      dbvalue.TimePtr(row.SubscriptionPeriodStart),
		PeriodEnd:        dbvalue.TimePtr(row.SubscriptionPeriodEnd),
		ScheduledPlanOID: row.ScheduledHubPlanOid.String,
		ScheduledInterval: hubruntime.BillingIntervalFromNull(
			row.ScheduledBillingInterval,
		),
	}
}
