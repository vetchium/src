package settings

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	settingsspec "github.com/vetchium/src/typespec/orgs/settings"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgusers "backend/internal/orgs/users"
)

// SetGoogleSignIn turns Google sign-in on or off under the Org row lock, the
// same lock that guards every seat decision. Off is refused while seats exceed
// what the plan allows without it (D2a), since the cap is lifted only while
// the feature is on.
func SetGoogleSignIn(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		var request settingsspec.SetGoogleSignInRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		if request.Enabled && s.GoogleSignIn == nil {
			s.Problem(ctx, w, orgsproblem.SSONotAvailableError)
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(ctx)
		tx, err := s.DB.Begin(ctx)
		if err != nil {
			s.InternalError(ctx, w, "begin Google sign-in change", err)
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := sqlc.New(tx)

		locked, err := q.LockOrgForGoogleSignIn(ctx, identity.OrgDID)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(ctx, w, orgsproblem.OrgSuspendedError)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "lock Org for Google sign-in", err)
			return
		}
		gold := subscriptionspec.PlanOID(subscriptionspec.GoldTier)
		if request.Enabled && subscriptionspec.PlanOID(locked.OrgPlanOid) != gold {
			s.Problem(ctx, w, orgsproblem.PlanRequiredError(subscriptionspec.GoldTier))
			return
		}
		if !request.Enabled && locked.GoogleSignInEnabled {
			// Seats are read after the lock, in their own statement, so the
			// count reflects every commit that preceded it.
			seats, err := q.GetOrgSeatsInUse(ctx, identity.OrgDID)
			if err != nil {
				s.InternalError(ctx, w, "count Org seats", err)
				return
			}
			var scheduled *subscriptionspec.Plan
			if locked.ScheduledOrgPlanOid.Valid {
				plan := subscriptionspec.Plan(locked.ScheduledOrgPlanOid.String)
				scheduled = &plan
			}
			limit, unlimited := orgusers.SeatLimit(
				subscriptionspec.PlanOID(locked.OrgPlanOid), scheduled, false,
			)
			if !unlimited && seats > int64(limit) {
				s.Problem(ctx, w, orgsproblem.UserLimitExceedsTargetError(
					int32(limit), int32(seats),
				))
				return
			}
		}
		if err := q.SetOrgGoogleSignIn(ctx, sqlc.SetOrgGoogleSignInParams{
			Enabled:  request.Enabled,
			OrgDid:   identity.OrgDID,
			TenantID: s.TenantID,
			ActorID:  dbvalue.FormatUUID(identity.UserID),
		}); err != nil {
			s.InternalError(ctx, w, "set Google sign-in", err)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			s.InternalError(ctx, w, "commit Google sign-in change", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.Empty(ctx, w, http.StatusNoContent)
	}
}
