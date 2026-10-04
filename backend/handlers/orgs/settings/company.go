package settings

import (
	"net/http"

	settingsspec "github.com/vetchium/src/typespec/orgs/settings"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

func SetCompanyName(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request settingsspec.SetCompanyNameRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.OrgIdentityFromContext(ctx)
		tx, err := s.DB.Begin(ctx)
		if err != nil {
			s.InternalError(ctx, w, "begin company name change", err)
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := sqlc.New(tx)
		if _, err = q.LockOrgForBilling(ctx, identity.OrgDID); err != nil {
			s.InternalError(ctx, w, "lock company", err)
			return
		}
		row, err := q.GetOrgSubscription(ctx, identity.OrgDID)
		if err != nil {
			s.InternalError(ctx, w, "read company state", err)
			return
		}
		if row.OrgState != sqlc.VetchiumOrgStateActive {
			s.Problem(ctx, w, orgsproblem.OrgSuspendedError)
			return
		}
		if err = q.SetOrgCompanyName(ctx, sqlc.SetOrgCompanyNameParams{
			OrgDid:         identity.OrgDID,
			DisplayName:    string(request.DisplayName),
			TenantID:       s.TenantID,
			ActorOrgUserID: identity.UserID,
		}); err != nil {
			s.InternalError(ctx, w, "set company name", err)
			return
		}
		if err = tx.Commit(ctx); err != nil {
			s.InternalError(ctx, w, "commit company name", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.Empty(ctx, w, http.StatusNoContent)
	}
}
