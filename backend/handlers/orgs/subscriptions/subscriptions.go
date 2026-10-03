package subscriptions

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
	"backend/internal/orgs/entitlements"
	orgusers "backend/internal/orgs/users"
)

func response(row sqlc.GetOrgSubscriptionRow) subscriptionspec.OrgSubscription {
	result := subscriptionspec.OrgSubscription{
		PlanOID: subscriptionspec.PlanOID(row.OrgPlanOid), SeatsInUse: int32(row.SeatsInUse),
	}
	if row.OrgBillingInterval.Valid {
		interval := subscriptionspec.BillingInterval(row.OrgBillingInterval.VetchiumOrgBillingInterval)
		result.BillingInterval = &interval
	}
	if limit, unlimited := orgusers.SeatLimit(result.PlanOID, row.GoogleSignInEnabled); !unlimited {
		value := int32(limit)
		result.SeatLimit = &value
	}
	return result
}

func MySubscription(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		row, err := s.Queries.GetOrgSubscription(r.Context(), identity.OrgDID)
		if errors.Is(err, pgx.ErrNoRows) {
			s.AuthenticationProblem(r.Context(), w, orgsproblem.AuthenticationRequiredError, orgsauthn.BearerChallenge)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get Org subscription", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response(row))
	}
}

func SetSubscriptionPlan(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request subscriptionspec.SetSubscriptionPlanRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		type result = handlerauth.Result[subscriptionspec.OrgSubscription]
		handlerauth.RunIdempotent(s, w, r, "orgs:set-subscription-plan", dbvalue.FormatUUID(identity.UserID), key, request, s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				if !s.Offers(request.PlanOID) {
					return handlerauth.Failure[subscriptionspec.OrgSubscription](orgsproblem.PlanNotOfferedError)
				}
				if _, err := q.LockOrgForBilling(ctx, identity.OrgDID); err != nil {
					return result{}, nil, err
				}
				row, err := q.GetOrgSubscription(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, err
				}
				if row.OrgState != sqlc.VetchiumOrgStateActive {
					return handlerauth.Failure[subscriptionspec.OrgSubscription](orgsproblem.OrgSuspendedError)
				}
				if row.OrgPlanOid == string(request.PlanOID) && string(row.OrgBillingInterval.VetchiumOrgBillingInterval) == string(request.BillingInterval.Value) {
					return result{Status: http.StatusOK, Body: response(row)}, nil, nil
				}
				limit, unlimited := subscriptionspec.MaxUsers(request.PlanOID, row.GoogleSignInEnabled)
				if !unlimited && row.SeatsInUse > int64(limit) {
					return handlerauth.Failure[subscriptionspec.OrgSubscription](orgsproblem.UserLimitExceedsTargetError(int32(limit), int32(row.SeatsInUse)))
				}
				interval := sqlc.NullVetchiumOrgBillingInterval{VetchiumOrgBillingInterval: sqlc.VetchiumOrgBillingInterval(request.BillingInterval.Value), Valid: request.BillingInterval.Present}
				err = q.SaveOrgSubscription(ctx, sqlc.SaveOrgSubscriptionParams{
					OrgDid: identity.OrgDID, OrgPlanOid: string(request.PlanOID), OrgBillingInterval: pgtype.Text{String: string(request.BillingInterval.Value), Valid: request.BillingInterval.Present},
					GoogleSignInPlanOids: entitlements.PlanOIDs(subscriptionspec.AllowsGoogleSignIn),
					LogoPlanOids:         entitlements.PlanOIDs(subscriptionspec.AllowsLogo), TenantID: s.TenantID,
					ActorOrgUserID: identity.UserID, IdempotencyKey: pgtype.Text{String: string(key), Valid: true},
				})
				if err != nil {
					return result{}, nil, err
				}
				row.OrgPlanOid = string(request.PlanOID)
				row.OrgBillingInterval = interval
				row.GoogleSignInEnabled = row.GoogleSignInEnabled && subscriptionspec.AllowsGoogleSignIn(request.PlanOID)
				return result{Status: http.StatusOK, Body: response(row)}, nil, nil
			})
	}
}
